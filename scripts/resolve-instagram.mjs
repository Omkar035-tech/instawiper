#!/usr/bin/env node
import instagram from './instagram-service-standalone.mjs';
import axios from 'axios';

function extractShortcode(input){
  if(!input) return null;
  if(/^[A-Za-z0-9_-]{5,}$/.test(input)) return input;
  try{
    const u = new URL(input);
    const parts = u.pathname.split('/').filter(Boolean);
    if(parts.length >= 2) return parts[1];
  }catch(e){
    if(/^[A-Za-z0-9_-]{5,}$/.test(input)) return input;
  }
  return null;
}

function decodeHtmlEntities(str){
  if(!str) return str;
  return str.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

async function fetchCaption(shortcode){
  try{
    const url = `https://www.instagram.com/p/${shortcode}/`;
    const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const html = r.data || '';
    let m = html.match(/<meta property="og:description" content="([\s\S]*?)"\s*\/?>/i);
    if(m && m[1]) return decodeHtmlEntities(m[1]).trim();
    m = html.match(/<meta name="description" content="([\s\S]*?)"\s*\/?>/i);
    if(m && m[1]) return decodeHtmlEntities(m[1]).trim();
  }catch(e){}
  return null;
}

(async function main(){
  const input = process.argv[2];
  if(!input){
    console.error(JSON.stringify({ error: 'Usage: node scripts/resolve-instagram.mjs <shortcode-or-url>' }));
    process.exit(2);
  }

  const shortcode = extractShortcode(input);
  if(!shortcode){
    console.error(JSON.stringify({ error: 'Could not extract shortcode from input', input }));
    process.exit(3);
  }

  let caption = null;
  try{ caption = await fetchCaption(shortcode); }catch(e){}

  let info;
  try{
    info = await instagram({ postId: shortcode });
  }catch(e){
    console.error(JSON.stringify({ error: 'instagram service error', detail: String(e) }));
    process.exit(4);
  }

  const media = [];
  if(info && info.picker && Array.isArray(info.picker)){
    for(const p of info.picker){
      if(p && p.url) media.push({ url: p.url, type: p.type || 'photo', thumb: p.thumb || null });
    }
  }else if(info && info.urls){
    if(Array.isArray(info.urls)){
      for(const u of info.urls) media.push({ url: u, type: info.isPhoto ? 'photo' : 'video', thumb: null });
    }else{
      media.push({ url: info.urls, type: info.isPhoto ? 'photo' : 'video', thumb: info.thumb || null });
    }
  }

  if(!media.length){
    console.error(JSON.stringify({ error: 'No media found', shortcode }));
    process.exit(5);
  }

  const out = { shortcode, caption, media };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})();
