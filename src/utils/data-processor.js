const moment = require('moment');
const DEFAULT = require("../default.json");
const inquirer = require('inquirer');

const MAX_SEASON_EP_COUNT = DEFAULT.maxSeasonEpCount; // 默认每季集数.
const MAX_OLD_BANGUMI_MONTH = DEFAULT.maxOldBangumiMonth; // 未结束老番最大月数
const EP_LENGTH = DEFAULT.epLength; // 默认每集动画时长（分钟）
const PREFER_SITES = DEFAULT.preferSites; // 默认偏好站点
const BANGUMI_URL = DEFAULT.bangumiUrl; // 默认番剧 url

const NO_ON_AIR_MSG = '无';
const SITE_TYPE_ONAIR = 'onair';
const SITE_TYPE_INFO = 'info';


const getInitialDateOfOldBangumi = (beginTime, timeNow) => {
  const newTime = timeNow.clone();
  newTime.hour(beginTime.hour());
  newTime.minute(beginTime.minute());
  if (timeNow.day() === beginTime.day()) {
    return newTime;
  }
  newTime.day(beginTime.day() + 7);
  return newTime;
};

const getBangumiName = bangumi => {
  if (bangumi.titleTranslate && bangumi.titleTranslate['zh-Hans']) {
    return bangumi.titleTranslate['zh-Hans'][0]; // 有中文翻译就获取第一个中文翻译
  }
  return bangumi.title; // 没有就直接取title
};

const getBangumiSiteList = (bangumi, siteMeta) => {
  const resultList = [];
  if (bangumi && bangumi.sites && Array.isArray(bangumi.sites)) {
    const {
      sites
    } = bangumi;
    sites.forEach(site => {
      const siteInfo = siteMeta[site.site];
      if (
        siteInfo &&
        siteInfo.title &&
        siteInfo.urlTemplate &&
        siteInfo.type &&
        siteInfo.type === SITE_TYPE_ONAIR || SITE_TYPE_INFO // 避免没有 ONAIR 站点时 resultList 为空
      ) {
        resultList.push({
          site: site.site,
          title: siteInfo.title,
          url: siteInfo.urlTemplate.replace('{{id}}', site.id),
        });
      }
    });
  }
  return resultList;
};

const getBangumiDescription = siteList => {
  if (siteList.length > 0) {
    return siteList
      .map(site => `${site.title}：${site.url}`)
      .reduce((prev, next) => `${prev}\n${next}`);
  }
  return NO_ON_AIR_MSG;
};

const getBangumiUrl = siteList => {
  if (siteList.length <= 0) return BANGUMI_URL; // 避免返回 null 导致 ics 创建失败
  PREFER_SITES.forEach(prefer => {
    const foundSite = siteList.find(site => site.site === prefer);
    if (foundSite) {
      return foundSite.url;
    }
  });
  return siteList[0].url;
};

const getBangumiOnAirTimes = (bangumi, timeNow) => {
  const now = timeNow.clone();
  const resultList = [];
  const beginTime = moment(bangumi.begin);
  if (bangumi.isNew) {
    // 新番默认有MAX_SEASON_EP_COUNT集
    for (let i = 0; i < MAX_SEASON_EP_COUNT; i++) {
      if (beginTime.isAfter(now)) {
        resultList.push(beginTime.format('YYYY-M-D-H-m').split('-').map(Number));
      }
      beginTime.add(1, 'w');
    }
  } else {
    // 老番不知结束时间默认添加MAX_OLD_BANGUMI_MONTH个月
    const initialTime = getInitialDateOfOldBangumi(beginTime, now);
    const endTime = now.add(MAX_OLD_BANGUMI_MONTH, 'M');
    while (initialTime.isBefore(endTime)) {
      resultList.push(initialTime.format('YYYY-M-D-H-m').split('-').map(Number));
      initialTime.add(1, 'w');
    }
  }
  return resultList;
};

// 递归调用直到用户输入的剩余集数值符合条件
function promptEpisodes(bangumi) {
  return inquirer.prompt([{
    type: 'number',
    name: 'episodes',
    message: `${bangumi.title} 有多少集未播出`,
    validate: (value) => {
      if (Number.isNaN(value) || value < 1 || !Number.isInteger(value)) {
        return '请输入一个大于等于 1 的正整数。';
      }
      return true;
    }
  }])
    .then((answers) => {
      return answers.episodes;
    })
    .catch((error) => {
      console.log(error);
      return promptEpisodes();
    });
}

// 使用用户输入的剩余集数计算时间表
const getOnAirTimesFromUser = async (bangumi, timeNow) => {
  const now = timeNow.clone();
  const resultList = [];
  let beginTime = moment(bangumi.begin);
  let seasonEpCount = await promptEpisodes(bangumi);

  if (!bangumi.isNew) {
    // 老番重新计算起始时间
    beginTime = getInitialDateOfOldBangumi(beginTime, now);
  }
  // 新番和老番使用同一时间表计算方法
  for (let i = 0; i < seasonEpCount; i++) {
    if (beginTime.isAfter(now)) {
      resultList.push(beginTime.format('YYYY-M-D-H-m').split('-').map(Number));
    }
    beginTime.add(1, 'w');
  }
  return resultList;
};

const getEventsFromData = async (bangumiData, siteMeta, timeNow) => {
  const events = [];
  // 询问用户是否要手动输入番剧的集数
  const boolManually = await inquirer.prompt([{
    type: 'confirm',
    name: 'state',
    message: '是否手动输入番剧集数：',
    default: false
  }])
  for (const item of bangumiData) {
    // const titlePrefix = item.isNew ? '本季新番' : '上季旧番';
    const siteList = getBangumiSiteList(item, siteMeta);
    // 根据用户不同选择调用不同方法
    const onAirTimes = boolManually.state? await getOnAirTimesFromUser(item, timeNow) : getBangumiOnAirTimes(item, timeNow);
    for (const onAirTime of onAirTimes) {
      const newEvent = {
        start: onAirTime,
        duration: {
          minutes: EP_LENGTH,
        },
        description: getBangumiDescription(siteList),
        title: getBangumiName(item),
        url: getBangumiUrl(siteList),
      };
      events.push(newEvent);
    }
  }
  return events;
};

module.exports = {
  getBangumiName,
  getEventsFromData
};