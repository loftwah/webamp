const db = require("../db");
const path = require("path");
const skins = db.get("skins");
const iaItems = db.get("internetArchiveItems");
const S3 = require("../s3");
const logger = require("../logger");

const TWEETABLE_QUERY = {
  tweeted: { $ne: true },
  approved: true,
  rejected: { $ne: true },
  type: "CLASSIC",
};

const REVIEWABLE_QUERY = {
  tweeted: { $ne: true },
  approved: { $ne: true },
  rejected: { $ne: true },
  type: "CLASSIC",
};
function getSkinRecord(skin) {
  const {
    md5,
    averageColor,
    emails,
    tweetUrl,
    twitterLikes,
    readmeText,
    filePaths,
  } = skin;
  const fileNames = filePaths.map(p => path.basename(p));
  const skinUrl = `https://s3.amazonaws.com/webamp-uploaded-skins/skins/${md5}.wsz`;
  return {
    skinUrl,
    screenshotUrl: `https://s3.amazonaws.com/webamp-uploaded-skins/screenshots/${md5}.png`,
    md5,
    averageColor,
    fileNames,
    canonicalFilename: fileNames != null ? fileNames[0] : null,
    emails,
    tweetUrl,
    twitterLikes,
    webampUrl: `https://webamp.org?skinUrl=${skinUrl}`,
    readmeText,
  };
}

async function getProp(md5, prop) {
  const skin = await skins.findOne({ md5, type: "CLASSIC" });
  const value = skin && skin[prop];
  return value == null ? null : value;
}

const IA_URL = /^(https:\/\/)?archive.org\/details\/([^\/]+)\/?/;
const MD5 = /([a-fA-F0-9]{32})/;

async function getMd5ByAnything(anything) {
  const md5Match = anything.match(MD5);
  if (md5Match != null) {
    const md5 = md5Match[1];
    return md5;
  }
  const itemMatchResult = anything.match(IA_URL);
  if (itemMatchResult != null) {
    const itemName = itemMatchResult[2];
    const md5 = await getMd5FromInternetArchvieItemName(itemName);
    if (md5 != null) {
      return md5;
    }
  }
  const md5 = await getMd5FromInternetArchvieItemName(anything);
  if (md5 != null) {
    return md5;
  }
}

async function getSkinByMd5(md5) {
  const skin = await skins.findOne({ md5, type: "CLASSIC" });
  if (skin == null) {
    logger.warn("Could not find skin in database", { md5, alert: true });
    return null;
  }
  const internetArchiveItem = await getInternetArchiveItem(md5);
  let internetArchiveUrl = null;
  let internetArchiveItemName = null;
  if (internetArchiveItem != null) {
    internetArchiveItemName = internetArchiveItem.identifier;
    internetArchiveUrl = getInternetArchiveUrl(internetArchiveItemName);
  }
  const tweetStatus = await getStatus(md5);
  return {
    ...getSkinRecord(skin),
    tweetStatus,
    internetArchiveItemName,
    internetArchiveUrl,
  };
}

async function getReadme(md5) {
  return getProp(md5, "readmeText");
}

async function getScreenshotUrl(md5) {
  return getProp(md5, "screenshotUrl");
}

async function getSkinUrl(md5) {
  return getProp(md5, "skinUrl");
}

async function getInternetArchiveItem(md5) {
  return iaItems.findOne({ md5: md5 });
}

async function getMd5FromInternetArchvieItemName(itemName) {
  const item = await iaItems.findOne({ identifier: itemName }, { md5: 1 });
  return item == null ? null : item.md5;
}

function getInternetArchiveUrl(itemName) {
  return itemName == null ? null : `https://archive.org/details/${itemName}`;
}

function getTweetableSkinCount() {
  return skins.count(TWEETABLE_QUERY);
}

async function markAsTweeted(md5) {
  await skins.findOneAndUpdate({ md5 }, { $set: { tweeted: true } });
  return S3.markAsTweeted(md5);
}

async function getStatus(md5) {
  const skin = await skins.findOne({ md5 });
  if (skin.tweeted) {
    return "TWEETED";
  }
  if (skin.rejected) {
    return "REJECTED";
  }
  if (skin.approved) {
    return "APPROVED";
  }
  return "UNREVIEWED";
}

async function approve(md5) {
  await skins.findOneAndUpdate({ md5 }, { $set: { approved: true } });
  return S3.approve(md5);
}

async function reject(md5) {
  await skins.findOneAndUpdate({ md5 }, { $set: { rejected: true } });
  return S3.reject(md5);
}

async function getSkinToReview() {
  const skin = await skins.findOne(REVIEWABLE_QUERY);
  const { canonicalFilename, md5 } = getSkinRecord(skin);
  return { filename: canonicalFilename, md5 };
}

async function getSkinToTweet() {
  const skin = await skins.findOne(TWEETABLE_QUERY);
  if (skin == null) {
    return null;
  }
  const { canonicalFilename, md5 } = getSkinRecord(skin);
  return { filename: canonicalFilename, md5 };
}

async function getStats() {
  const approved = await skins.count({ approved: true });
  const rejected = await skins.count({ rejected: true });
  const tweeted = await skins.count({ tweeted: true });
  const tweetable = await getTweetableSkinCount();
  return { approved, rejected, tweeted, tweetable };
}

async function reconcile() {
  const [approved, rejected, tweeted] = await Promise.all([
    S3.getAllApproved(),
    S3.getAllRejected(),
    S3.getAllTweeted(),
  ]);
  await Promise.all([
    ...approved.map(md5 =>
      skins.findOneAndUpdate({ md5 }, { $set: { approved: true } })
    ),
    ...rejected.map(md5 =>
      skins.findOneAndUpdate({ md5 }, { $set: { rejected: true } })
    ),
    ...tweeted.map(md5 =>
      skins.findOneAndUpdate({ md5 }, { $set: { tweeted: true } })
    ),
  ]);
}

module.exports = {
  getInternetArchiveItem,
  getMd5ByAnything,
  getReadme,
  getScreenshotUrl,
  getSkinUrl,
  getInternetArchiveUrl,
  getSkinByMd5,
  markAsTweeted,
  getStatus,
  approve,
  reject,
  getSkinToReview,
  getStats,
  getTweetableSkinCount,
  reconcile,
  getSkinToTweet,
};
