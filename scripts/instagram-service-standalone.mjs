#!/usr/bin/env node
// Standalone port of the repository's instagram service (best-effort, no repo deps)
// Exports: async function instagram(obj) - accepts { postId, shareId, storyId, username, alwaysProxy }

import { randomBytes } from 'node:crypto';

const commonHeaders = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'sec-gpc': '1',
  'sec-fetch-site': 'same-origin',
  'x-ig-app-id': '936619743392459'
};

const mobileHeadersBase = {
  'x-ig-app-locale': 'en_US',
  'x-ig-device-locale': 'en_US',
  'x-ig-mapped-locale': 'en_US',
  'user-agent': 'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423)',
  'accept-language': 'en-US',
  'x-fb-http-engine': 'Liger',
  'x-fb-client-ip': 'True',
  'x-fb-server-cluster': 'True',
  'content-length': '0'
};

const embedHeaders = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'max-age=0',
  'Dnt': '1',
  'User-Agent': commonHeaders['user-agent']
};

function getNumberFromQuery(name, data) {
  const s = data?.match(new RegExp(name + '=(\\d+)'))?.[1];
  if (+s) return +s;
}

function getObjectFromEntries(name, data) {
  const obj = data?.match(new RegExp('\\["' + name + '",.*?,({.*?}),\\d+\\]'))?.[1];
  return obj && JSON.parse(obj);
}

function parseCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return {};
  return cookieStr.split(';').map(s => s.trim()).reduce((acc, kv) => {
    const [k, ...v] = kv.split('=');
    acc[k] = v.join('=');
    return acc;
  }, {});
}

// lightweight cookie container with values() method to mimic repo usage
class SimpleCookie {
  constructor(cookieString) {
    this.map = parseCookieString(cookieString || '');
    this._wwwClaim = undefined;
  }
  values() { return this.map; }
  toString() { return Object.entries(this.map).map(([k,v])=>`${k}=${v}`).join('; '); }
}

function updateCookie(cookieObj, headers) {
  // simple patch: if Set-Cookie present, merge first header's key/val
  try {
    const setCookie = headers.get ? headers.get('set-cookie') : headers['set-cookie'];
    if (!setCookie || !cookieObj) return;
    // set-cookie may be comma-separated; take first
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const kv = first.split(';')[0].split('=');
    cookieObj.map[kv[0]] = kv.slice(1).join('=');
  } catch (e) {}
}

async function resolveRedirectingURL(url) {
  // fetch and return final pathname segments; follow redirects
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const final = res.url || url;
    const u = new URL(final);
    // try to extract postId or shortcode from path
    const parts = u.pathname.split('/').filter(Boolean);
    // possible forms: p/{id}, reel/{id}, share/{shareId}
    if (parts.length >= 2) {
      const kind = parts[0];
      const id = parts[1];
      if (kind === 'p' || kind === 'reel') return { postId: id };
    }
    return {};
  } catch (e) {
    return {};
  }
}

function pickBestVideoFromMedia(media) {
  if (!media) return null;
  if (media.video_url) return media.video_url;
  if (media.video_versions && Array.isArray(media.video_versions)) {
    const best = media.video_versions.reduce((a,b)=> (a.width*a.height) < (b.width*b.height) ? b : a);
    return best?.url || null;
  }
  if (media.image_versions2?.candidates) return media.image_versions2.candidates[0].url;
  if (media.display_url) return media.display_url;
  // sidecar
  const sidecar = media.edge_sidecar_to_children?.edges || media.carousel_media;
  if (sidecar && Array.isArray(sidecar)) {
    for (const e of sidecar) {
      const node = e.node || e;
      if (!node) continue;
      if (node.is_video && node.video_url) return node.video_url;
      if (node.video_versions && node.video_versions.length) {
        const best = node.video_versions.reduce((a,b)=> (a.width*a.height) < (b.width*b.height) ? b : a);
        if (best?.url) return best.url;
      }
      if (node.display_url) return node.display_url;
    }
  }
  return null;
}

export default async function instagram(obj = {}) {
  const dispatcher = obj.dispatcher; // not used in standalone

  async function findDtsgId(cookie) {
    try {
      const cookieStr = cookie ? cookie.toString() : undefined;
      const data = await fetch('https://www.instagram.com/', { headers: { ...commonHeaders, cookie: cookieStr } }).then(r=>r.text());
      const m = data.match(/"dtsg":\{"token":"(.*?)"/);
      const token = m?.[1];
      return token || false;
    } catch (e) { return false; }
  }

  async function request(url, cookie, method='GET', requestData) {
    const cookieStr = cookie ? cookie.toString() : undefined;
    let headers = { ...commonHeaders, 'x-ig-www-claim': cookie?._wwwClaim || '0', 'x-csrftoken': cookie?.values()?.csrftoken, cookie: cookieStr };
    if (method === 'POST') headers['content-type']='application/x-www-form-urlencoded';
    const res = await fetch(url, { method, headers, body: requestData ? new URLSearchParams(requestData) : undefined });
    try { updateCookie(cookie, res.headers); } catch (e) {}
    return res.json().catch(()=>null);
  }

  async function getMediaId(id, { cookie, token } = {}) {
    const oembedURL = new URL('https://i.instagram.com/api/v1/oembed/');
    oembedURL.searchParams.set('url', `https://www.instagram.com/p/${id}/`);
    try {
      const headers = { ...mobileHeadersBase, ...( token && { authorization: `Bearer ${token}` } ), cookie: cookie?.toString() };
      const oembed = await fetch(oembedURL.href, { headers }).then(r=>r.json()).catch(()=>null);
      return oembed?.media_id;
    } catch (e) { return undefined; }
  }

  async function requestMobileApi(mediaId, { cookie, token } = {}) {
    try {
      const headers = { ...mobileHeadersBase, ...( token && { authorization: `Bearer ${token}` } ), cookie: cookie?.toString() };
      const mediaInfo = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, { headers }).then(r=>r.json()).catch(()=>null);
      return mediaInfo?.items?.[0];
    } catch (e) { return undefined; }
  }

  async function requestHTML(id, cookie) {
    try {
      const headers = { ...embedHeaders, cookie: cookie?.toString() };
      const data = await fetch(`https://www.instagram.com/p/${id}/embed/captioned/`, { headers }).then(r=>r.text()).catch(()=>null);
      if (!data) return false;
      const match = data.match(/"init",\[\],\[(.*?)\]\],/s)?.[1];
      if (!match) return false;
      let embedData = JSON.parse(match);
      if (!embedData?.contextJSON) return false;
      embedData = JSON.parse(embedData.contextJSON);
      return embedData;
    } catch (e) { return false; }
  }

  async function getGQLParams(id, cookie) {
    const headers = { ...embedHeaders, cookie: cookie?.toString() };
    const req = await fetch(`https://www.instagram.com/p/${id}/`, { headers });
    const html = await req.text();
    const siteData = getObjectFromEntries('SiteData', html);
    const polarisSiteData = getObjectFromEntries('PolarisSiteData', html);
    const webConfig = getObjectFromEntries('DGWWebConfig', html);
    const pushInfo = getObjectFromEntries('InstagramWebPushInfo', html);
    const lsd = getObjectFromEntries('LSD', html)?.token || randomBytes(8).toString('base64url');
    const csrf = getObjectFromEntries('InstagramSecurityConfig', html)?.csrf_token;
    const anon_cookie = [ csrf && `csrftoken=${csrf}`, polarisSiteData?.device_id && `ig_did=${polarisSiteData.device_id}`, 'wd=1280x720', 'dpr=2', polarisSiteData?.machine_id && `mid=${polarisSiteData.machine_id}`, 'ig_nrcb=1' ].filter(Boolean).join('; ');

    return {
      headers: {
        'x-ig-app-id': webConfig?.appId || '936619743392459',
        'X-FB-LSD': lsd,
        'X-CSRFToken': csrf,
        'X-Bloks-Version-Id': getObjectFromEntries('WebBloksVersioningID', html)?.versioningID,
        'x-asbd-id': 129477,
        cookie: anon_cookie
      },
      body: {
        __d: 'www', __a: '1', __s: '::' + Math.random().toString(36).substring(2).replace(/\d/g,'').slice(0,6), __hs: siteData?.haste_session || '20126.HYP:instagram_web_pkg.2.1...0', __req: 'b', __ccg: 'EXCELLENT', __rev: pushInfo?.rollout_hash || '1019933358', __hsi: siteData?.hsi || '7436540909012459023', __dyn: randomBytes(154).toString('base64url'), __csr: randomBytes(154).toString('base64url'), __user: '0', __comet_req: getNumberFromQuery('__comet_req', html) || '7', av: '0', dpr: '2', lsd, jazoest: getNumberFromQuery('jazoest', html) || Math.floor(Math.random()*10000), __spin_r: siteData?.__spin_r || '1019933358', __spin_b: siteData?.__spin_b || 'trunk', __spin_t: siteData?.__spin_t || Math.floor(Date.now()/1000)
      }
    };
  }

  async function requestGQL(id, cookie) {
    const { headers, body } = await getGQLParams(id, cookie);
    const req = await fetch('https://www.instagram.com/graphql/query', {
      method: 'POST',
      headers: { ...embedHeaders, ...headers, cookie: cookie?.toString(), 'content-type': 'application/x-www-form-urlencoded', 'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery' },
      body: new URLSearchParams({ ...body, fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery', variables: JSON.stringify({ shortcode: id, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }), server_timestamps: true, doc_id: '8845758582119845' }).toString()
    });

    return { gql_data: await req.json().then(r=>r.data).catch(()=>null) };
  }

  async function getErrorContext(id) {
    try {
      const { headers, body } = await getGQLParams(id);
      const req = await fetch('https://www.instagram.com/ajax/bulk-route-definitions/', {
        method: 'POST', headers: { ...embedHeaders, ...headers, 'content-type': 'application/x-www-form-urlencoded', 'X-Ig-D': 'www' }, body: new URLSearchParams({ 'route_urls[0]': `/p/${id}/`, routing_namespace: 'igx_www', ...body }).toString()
      });
      const response = await req.text();
      if (response.includes('"tracePolicy":"polaris.privatePostPage"')) return { error: 'content.post.private' };
      const [, mediaId, mediaOwnerId] = response.match(/"media_id":\s*?"(\d+)","media_owner_id":\s*?"(\d+)"/) || [];
      if (mediaId && mediaOwnerId) {
        const rulingURL = new URL('https://www.instagram.com/api/v1/web/get_ruling_for_media_content_logged_out');
        rulingURL.searchParams.set('media_id', mediaId);
        rulingURL.searchParams.set('owner_id', mediaOwnerId);
        const rulingResponse = await fetch(rulingURL.href, { headers: { ...commonHeaders, ...headers } }).then(a=>a.json()).catch(()=>({}));
        if (rulingResponse?.title?.includes('Restricted')) return { error: 'content.post.age' };
      }
    } catch (e) { return { error: 'fetch.fail' } }
    return { error: 'fetch.empty' };
  }

  function extractOldPost(data, id, alwaysProxy) {
    const shortcodeMedia = data?.gql_data?.shortcode_media || data?.gql_data?.xdt_shortcode_media;
    const sidecar = shortcodeMedia?.edge_sidecar_to_children;
    if (sidecar) {
      const picker = sidecar.edges.filter(e => e.node?.display_url).map((e,i)=>{
        const type = e.node?.is_video && e.node?.video_url ? 'video' : 'photo';
        let url = type === 'video' ? e.node.video_url : e.node.display_url;
        return { type, url, thumb: e.node.display_url };
      });
      if (picker.length) return { picker };
    }
    if (shortcodeMedia?.video_url) return { urls: shortcodeMedia.video_url, filename: `instagram_${id}.mp4`, audioFilename: `instagram_${id}_audio` };
    if (shortcodeMedia?.display_url) return { urls: shortcodeMedia.display_url, isPhoto: true, filename: `instagram_${id}.jpg` };
  }

  function extractNewPost(data, id, alwaysProxy) {
    const carousel = data.carousel_media;
    if (carousel) {
      const picker = carousel.filter(e=>e?.image_versions2).map((e,i)=>{
        const type = e.video_versions ? 'video' : 'photo';
        const imageUrl = e.image_versions2.candidates[0].url;
        let url = imageUrl;
        if (type === 'video') {
          const video = e.video_versions.reduce((a,b)=> a.width*a.height < b.width*b.height ? b : a);
          url = video.url;
        }
        return { type, url, thumb: imageUrl };
      });
      if (picker.length) return { picker };
    } else if (data.video_versions) {
      const video = data.video_versions.reduce((a,b)=> a.width*a.height < b.width*b.height ? b : a);
      return { urls: video.url, filename: `instagram_${id}.mp4`, audioFilename: `instagram_${id}_audio` };
    } else if (data.image_versions2?.candidates) {
      return { urls: data.image_versions2.candidates[0].url, isPhoto: true, filename: `instagram_${id}.jpg` };
    }
  }

  async function getPost(id, alwaysProxy) {
    const hasData = (data) => data && data.gql_data !== null && data?.gql_data?.xdt_shortcode_media !== null;
    let data, result;
    try {
      const cookie = obj.cookie ? new SimpleCookie(obj.cookie) : undefined;
      const bearerToken = obj.bearer || undefined;
      const token = bearerToken;
      let media_id = await getMediaId(id);
      if (!media_id && token) media_id = await getMediaId(id, { token });
      if (!media_id && cookie) media_id = await getMediaId(id, { cookie });
      if (media_id && token) data = await requestMobileApi(media_id, { token });
      if (media_id && !hasData(data)) data = await requestMobileApi(media_id);
      if (media_id && cookie && !hasData(data)) data = await requestMobileApi(media_id, { cookie });
      if (!hasData(data)) data = await requestHTML(id);
      if (!hasData(data) && cookie) data = await requestHTML(id, cookie);
      if (!hasData(data)) data = await requestGQL(id);
      if (!hasData(data) && cookie) data = await requestGQL(id, cookie);
    } catch (e) {}
    if (!hasData(data)) return getErrorContext(id);
    if (data?.gql_data) result = extractOldPost(data, id, alwaysProxy); else result = extractNewPost(data, id, alwaysProxy);
    if (result) return result; return { error: 'fetch.empty' };
  }

  async function usernameToId(username, cookie) {
    const url = new URL('https://www.instagram.com/api/v1/users/web_profile_info/');
    url.searchParams.set('username', username);
    try {
      const data = await request(url, cookie);
      return data?.data?.user?.id;
    } catch (e) {}
  }

  async function getStory(username, id) {
    const cookie = new SimpleCookie(obj.cookie);
    if (!cookie) return { error: 'link.unsupported' };
    const userId = await usernameToId(username, cookie);
    if (!userId) return { error: 'fetch.empty' };
    const dtsgId = await findDtsgId(cookie);
    const url = new URL('https://www.instagram.com/api/graphql/');
    const requestData = { fb_dtsg: dtsgId, jazoest: '26438', variables: JSON.stringify({ reel_ids_arr: [userId] }), server_timestamps: true, doc_id: '25317500907894419' };
    let media;
    try {
      const data = (await request(url, cookie, 'POST', requestData));
      media = data?.data?.xdt_api__v1__feed__reels_media?.reels_media?.find(m => m.id === userId);
    } catch (e) {}
    const item = media.items.find(m => m.pk === id);
    if (!item) return { error: 'fetch.empty' };
    if (item.video_versions) {
      const video = item.video_versions.reduce((a,b)=> a.width*a.height < b.width*b.height ? b : a);
      return { urls: video.url, filename: `instagram_${id}.mp4`, audioFilename: `instagram_${id}_audio` };
    }
    if (item.image_versions2?.candidates) return { urls: item.image_versions2.candidates[0].url, isPhoto: true, filename: `instagram_${id}.jpg` };
    return { error: 'link.unsupported' };
  }

  const { postId, shareId, storyId, username, alwaysProxy } = obj;

  if (shareId) {
    return resolveRedirectingURL(`https://www.instagram.com/share/${shareId}/`).then(match => instagram({ ...obj, ...match, shareId: undefined }));
  }
  if (postId) return getPost(postId, alwaysProxy);
  if (username && storyId) return getStory(username, storyId);
  return { error: 'fetch.empty' };
}
