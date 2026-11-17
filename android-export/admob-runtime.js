import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize
} from '@capacitor-community/admob';

const TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917'
};

let initialized = false;
let config = null;

function readConfig() {
  try {
    const project = JSON.parse(localStorage.getItem('gamezaar_racing_settings') || '{}');
    return project.monetization || {};
  } catch (_) {
    return {};
  }
}

function adOptions(format) {
  const testMode = config.testMode !== false;
  const customId = format === 'banner' ? config.bannerId :
    format === 'interstitial' ? config.interstitialId : config.rewardedId;
  return {
    adId: testMode ? TEST_IDS[format] : String(customId || '').trim(),
    isTesting: testMode
  };
}

async function initializeAds() {
  if (!Capacitor.isNativePlatform()) return false;
  config = readConfig();
  if (!config.bannerOn && !config.interstitialOn && !config.rewardedOn) return false;

  if (!config.testMode) {
    const enabledIds = [
      config.bannerOn && config.bannerId,
      config.interstitialOn && config.interstitialId,
      config.rewardedOn && config.rewardedId
    ].filter(Boolean);
    if (enabledIds.length === 0) {
      console.warn('[GAMEZAAR Ads] Production mode is ON, but no enabled ad unit has an ID.');
      return false;
    }
  }

  try {
    const consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
      await AdMob.showConsentForm();
    }
    const refreshedConsent = await AdMob.requestConsentInfo();
    if (!refreshedConsent.canRequestAds) {
      console.info('[GAMEZAAR Ads] Ads are waiting for consent.');
      return false;
    }
    await AdMob.initialize();
    initialized = true;

    if (config.bannerOn) {
      const opts = adOptions('banner');
      if (opts.adId) {
        await AdMob.showBanner({
          ...opts,
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          position: config.bannerPosition === 'top' ? BannerAdPosition.TOP_CENTER : BannerAdPosition.BOTTOM_CENTER,
          margin: 0
        });
      }
    }
    return true;
  } catch (error) {
    console.warn('[GAMEZAAR Ads] Initialization failed; game will continue without ads.', error);
    return false;
  }
}

async function showInterstitial() {
  if (!initialized || !config?.interstitialOn) return false;
  try {
    const opts = adOptions('interstitial');
    if (!opts.adId) return false;
    await AdMob.prepareInterstitial(opts);
    await AdMob.showInterstitial();
    return true;
  } catch (error) {
    console.warn('[GAMEZAAR Ads] Interstitial unavailable.', error);
    return false;
  }
}

async function showRewarded() {
  if (!initialized || !config?.rewardedOn) return { earned: false };
  try {
    const opts = adOptions('rewarded');
    if (!opts.adId) return { earned: false };
    await AdMob.prepareRewardVideoAd(opts);
    const reward = await AdMob.showRewardVideoAd();
    const result = { earned: !!reward, reward: reward || null };
    window.dispatchEvent(new CustomEvent('gamezaar:rewarded', { detail: result }));
    return result;
  } catch (error) {
    console.warn('[GAMEZAAR Ads] Rewarded ad unavailable or not completed.', error);
    return { earned: false, error: String(error?.message || error) };
  }
}

window.GAMEZAAR_ADS = {
  initialize: initializeAds,
  showInterstitial,
  showRewarded,
  isNative: () => Capacitor.isNativePlatform(),
  getMode: () => config?.testMode === false ? 'production' : 'test'
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAds, { once: true });
} else {
  initializeAds();
}
