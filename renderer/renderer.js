'use strict';

/* =========================================================
   PULSE — источник данных: Deezer Open API (бесплатно, без
   ключа). Запросы идут через main-процесс (см. pulseMusic в
   preload.js), поэтому здесь только вызовы deezerGet(path).

   Важно: Deezer отдаёт треки как 30-секундные превью (t.preview) —
   это официальное бесплатное ограничение, не баг. Полноценный
   стриминг целых треков требует платного партнёрского API
   (Spotify/VK/Яндекс.Музыка выдают такие ключи только под
   лицензионное соглашение), поэтому в открытом бесплатном виде
   это невозможно.
   ========================================================= */

const RU_ARTISTS = ['Zemfira', 'Мумий Тролль', 'Баста', 'Макс Корж', 'Скриптонит', 'Клава Кока', 'Ленинград', 'MONATIK'];
// расширенный пул — используется только для дозагрузки «Моей волны», чтобы радио не повторялось
const EXTRA_WAVE_ARTISTS = [
  'Три дня дождя','Слава КПСС','MORGENSHTERN','Егор Крид','Григорий Лепс','Полина Гагарина',
  'Дельфин','Сплин','ДДТ','Кино','Би-2','IC3PEAK','Feduk','Элджей','Инстасамка',
  'Найк Борзов','Zivert','Artik & Asti','Дора','Тима Белорусских',
];
const TAGS = ['tg-1','tg-2','tg-3','tg-4','tg-5','tg-6','tg-7','tg-8'];
function pick(arr, seed){ return arr[seed % arr.length]; }
function fmtTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec/60), s = sec%60;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
}

function showToast(message, tone='default'){
  let toast = document.getElementById('pulse-toast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'pulse-toast';
    toast.setAttribute('role','status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

const likedTracks = new Map(); // id(string) -> track object
let currentUserId = null;
let currentOpenCollectionId = null;

function likeKey(id){ return String(id); }
function isLiked(id){ return likedTracks.has(likeKey(id)); }

function pluralTracks(n){
  const mod10 = n % 10, mod100 = n % 100;
  if(mod10 === 1 && mod100 !== 11) return 'трек';
  if([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'трека';
  return 'треков';
}

function likedStorageKey(){ return `pulse-liked-${currentUserId || 'guest'}`; }

function loadLikedFromStorage(){
  likedTracks.clear();
  try{
    const raw = localStorage.getItem(likedStorageKey());
    if(raw){
      JSON.parse(raw).forEach(t => likedTracks.set(likeKey(t.id), t));
    }
  }catch(e){ console.warn('Не удалось прочитать сохранённые лайки', e); }
}

function saveLikedToStorage(){
  try{
    localStorage.setItem(likedStorageKey(), JSON.stringify(Array.from(likedTracks.values())));
  }catch(e){ console.warn('Не удалось сохранить лайки', e); }
}

const ARTIST_PICKER_LIST = [...new Set([...RU_ARTISTS, ...EXTRA_WAVE_ARTISTS])];
let favoriteArtists = [];

function favoriteArtistsStorageKey(){ return `pulse-favorite-artists-${currentUserId || 'guest'}`; }
function loadFavoriteArtists(){
  try{
    const raw = localStorage.getItem(favoriteArtistsStorageKey());
    favoriteArtists = raw ? JSON.parse(raw).filter(Boolean) : [];
  }catch(e){ favoriteArtists = []; }
}
function saveFavoriteArtists(){
  localStorage.setItem(favoriteArtistsStorageKey(), JSON.stringify(favoriteArtists));
}
function renderArtistPicker(){
  const picker = document.getElementById('artist-picker');
  if(!picker) return;
  picker.innerHTML = '';
  ARTIST_PICKER_LIST.forEach(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `artist-choice${favoriteArtists.includes(name) ? ' selected' : ''}`;
    button.textContent = name;
    button.addEventListener('click', () => {
      if(favoriteArtists.includes(name)) favoriteArtists = favoriteArtists.filter(a => a !== name);
      else if(favoriteArtists.length < 8) favoriteArtists = [...favoriteArtists, name];
      renderArtistPicker();
    });
    picker.appendChild(button);
  });
  const count = document.getElementById('onboarding-count');
  const submit = document.getElementById('onboarding-submit');
  if(count) count.textContent = `Выбрано: ${favoriteArtists.length} из 8`;
  if(submit) submit.disabled = favoriteArtists.length < 3;
}
function showArtistOnboarding(){
  loadFavoriteArtists();
  if(localStorage.getItem(`pulse-onboarding-done-${currentUserId || 'guest'}`)) return;
  renderArtistPicker();
  document.getElementById('artist-onboarding').classList.remove('hidden');
}
function completeArtistOnboarding(){
  if(favoriteArtists.length < 3) return;
  saveFavoriteArtists();
  localStorage.setItem(`pulse-onboarding-done-${currentUserId || 'guest'}`, '1');
  document.getElementById('artist-onboarding').classList.add('hidden');
  startWave();
}
document.getElementById('onboarding-submit').addEventListener('click', completeArtistOnboarding);

function toggleLike(track){
  const key = likeKey(track.id);
  if(likedTracks.has(key)) likedTracks.delete(key);
  else likedTracks.set(key, track);
  saveLikedToStorage();
  refreshLikeUI();
}

function refreshLikeUI(){
  updateLikeBtn();
  const count = likedTracks.size;
  const label = `${count} ${pluralTracks(count)}`;
  const sideCount = document.getElementById('liked-count');
  if(sideCount) sideCount.textContent = label;
  const libCount = document.getElementById('library-liked-count');
  if(libCount) libCount.textContent = label;
  document.querySelectorAll('.like-heart[data-track-id]').forEach(btn => {
    btn.classList.toggle('liked', isLiked(btn.dataset.trackId));
  });
  // если сейчас открыт плейлист «Понравившиеся» — перерисовываем список,
  // чтобы снятый лайк сразу исчезал из этого экрана
  if(currentOpenCollectionId === 'liked' && !document.getElementById('view-playlist').classList.contains('hidden')){
    openLikedCollection();
  }
}

function likedCollectionThumbHTML(){
  return `<div class="thumb thumb-liked"><svg viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.4C0.6 7.6 2.4 4 6 4c2.1 0 3.6 1.1 4.5 2.4.3.5 1 1.4 1.5 2 .5-.6 1.2-1.5 1.5-2C14.4 5.1 15.9 4 18 4c3.6 0 5.4 3.6 4 7.1-2.5 4.8-10 9.4-10 9.4Z" fill="#fff"/></svg></div>`;
}

function collectionThumbHTML(collection){
  return collection.isLiked ? likedCollectionThumbHTML() : thumbHTML(collection);
}

function likedSongsCard(){
  const el = document.createElement('div');
  el.className = 'media-card';
  el.innerHTML = `
    <div class="thumb-wrap">
      ${likedCollectionThumbHTML()}
      <button class="card-play" title="Играть">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="card-name">Понравившиеся</div>
    <div class="card-sub" id="library-liked-count">${likedTracks.size} ${pluralTracks(likedTracks.size)}</div>
  `;
  el.addEventListener('click', () => openLikedCollection());
  return el;
}

function openLikedCollection(){
  openCollection({
    id: 'liked',
    name: 'Понравившиеся треки',
    desc: 'Плейлист',
    isLiked: true,
    tracks: Array.from(likedTracks.values()).reverse(),
  });
}
document.getElementById('nav-liked-songs').addEventListener('click', openLikedCollection);

/* =========================================================
   DEEZER LAYER
   ========================================================= */
async function deezerGet(path){
  if(!window.pulseMusic){ return null; }
  try{
    const data = await window.pulseMusic.request(path);
    if(!data || data.error) { console.warn('Deezer error:', data && data.message); return null; }
    return data;
  }catch(e){ console.warn('Deezer fetch failed', e); return null; }
}

function mapTrack(t, seed=0){
  return {
    id: t.id,
    title: t.title,
    artist: (t.artist && t.artist.name) || '—',
    artistId: t.artist && t.artist.id,
    album: (t.album && t.album.title) || '',
    duration: t.duration || 30,
    cover: (t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium || t.album.cover)) || null,
    preview: t.preview || null,
    tag: pick(TAGS, (t.id || seed)),
    liked: false,
  };
}

function normalizeArtistName(value){
  return String(value || '').trim().toLocaleLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
}

async function resolveArtistProfile(artistId, artistName){
  const requested = normalizeArtistName(artistName);
  // ID из трека используем только после проверки имени: Deezer иногда
  // возвращает не тот объект при повторном использовании старого результата.
  if(artistId){
    const byId = await deezerGet(`/artist/${artistId}`);
    if(byId && (!requested || normalizeArtistName(byId.name) === requested)) return byId;
  }
  const search = await deezerGet(`/search/artist?q=${encodeURIComponent(artistName || '')}&limit=10`);
  const candidates = search && search.data ? search.data : [];
  return candidates.find(a => normalizeArtistName(a.name) === requested) || candidates[0] || null;
}

async function openArtistProfile(artistId, artistName){
  switchView('artist');
  const nameEl = document.getElementById('artist-profile-name');
  const statsEl = document.getElementById('artist-profile-stats');
  const avatar = document.getElementById('artist-profile-avatar');
  const list = document.getElementById('artist-profile-tracks');
  nameEl.textContent = artistName || 'Исполнитель';
  statsEl.textContent = 'Загружаю профиль…';
  avatar.style.backgroundImage = '';
  list.innerHTML = '<p class="artist-loading">Загружаю треки исполнителя…</p>';

  const artist = await resolveArtistProfile(artistId, artistName);
  if(!artist){
    statsEl.textContent = 'Профиль временно недоступен';
    list.innerHTML = '<p class="artist-loading">Не удалось загрузить данные. Проверь интернет-соединение.</p>';
    return;
  }
  nameEl.textContent = artist.name || artistName || 'Исполнитель';
  const fanLabel = artist.nb_fan ? `${Number(artist.nb_fan).toLocaleString('ru-RU')} слушателей` : 'Deezer · профиль исполнителя';
  const albumLabel = artist.nb_album ? ` · ${artist.nb_album} альбомов` : '';
  statsEl.textContent = fanLabel + albumLabel;
  const picture = artist.picture_big || artist.picture_medium || artist.picture;
  if(picture) avatar.style.backgroundImage = `url('${picture}')`;

  const data = await deezerGet(`/artist/${artist.id}/top?limit=20`);
  const tracks = data && data.data ? data.data.filter(t => t.preview).map(t => mapTrack(t)) : [];
  list.innerHTML = '';
  if(!tracks.length){
    list.innerHTML = '<p class="artist-loading">У этого исполнителя пока нет доступных превью.</p>';
    return;
  }
  tracks.forEach((track, index) => list.appendChild(trackRow(track, index, tracks)));
}

/* =========================================================
   РЕНДЕР-ХЕЛПЕРЫ
   ========================================================= */
function thumbHTML(track_or_tag){
  // Единый рендер обложек: img позволяет отследить ошибку загрузки и показать fallback.
  if(typeof track_or_tag === 'string'){
    return `<div class="thumb ${track_or_tag}"><span class="thumb-fallback" aria-hidden="true"></span></div>`;
  }
  const { cover, tag } = track_or_tag;
  const safeCover = cover ? escapeHTML(cover) : '';
  return `<div class="thumb ${tag || 'tg-1'}${safeCover ? ' has-cover' : ''}">
    ${safeCover ? `<img src="${safeCover}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" />` : ''}
    <span class="thumb-fallback" aria-hidden="true"></span>
  </div>`;
}

function mediaCard({ name, sub, cover, tag, round=false, onClick }){
  const el = document.createElement('div');
  el.className = 'media-card' + (round ? ' round' : '');
  el.innerHTML = `
    <div class="thumb-wrap">
      ${thumbHTML({cover, tag})}
      <button class="card-play" title="Играть">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="card-name">${escapeHTML(name)}</div>
    <div class="card-sub">${escapeHTML(sub)}</div>
  `;
  el.addEventListener('click', onClick);
  return el;
}

function skeletonRail(container, count=6){
  container.innerHTML = '';
  for(let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'media-card';
    el.style.pointerEvents = 'none';
    el.innerHTML = `<div class="thumb-wrap"><div class="thumb tg-${(i%8)+1}" style="opacity:.4;animation:pulseSkeleton 1.2s ease-in-out infinite"></div></div><div class="card-name" style="opacity:.3">Загрузка…</div><div class="card-sub" style="opacity:.2">···</div>`;
    container.appendChild(el);
  }
}
// маленькая keyframe-анимация для скелетонов, добавляем один раз
(function injectSkeletonKeyframes(){
  const style = document.createElement('style');
  style.textContent = `@keyframes pulseSkeleton{0%,100%{opacity:.25}50%{opacity:.55}}`;
  document.head.appendChild(style);
})();

document.addEventListener('error', (event) => {
  const image = event.target;
  if(image instanceof HTMLImageElement && image.matches('.thumb img')) image.classList.add('failed');
}, true);

function renderRail(container, items, mapFn){
  container.innerHTML = '';
  if(!items.length){
    container.innerHTML = `<p style="color:var(--text-faint);padding:6px 2px">Не удалось загрузить — проверь интернет-соединение.</p>`;
    return;
  }
  items.forEach(item => container.appendChild(mapFn(item)));
}

function trackRow(track, index, queue, opts={}){
  const row = document.createElement('div');
  row.className = 'track-row';
  row.innerHTML = `
    <span class="track-idx">${index+1}</span>
    <button class="track-row-play">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor"/></svg>
    </button>
    <div class="track-main">
      ${opts.showThumb === false ? '' : thumbHTML(track)}
      <div class="track-titles">
        <div class="track-name">${escapeHTML(track.title)}</div>
        <button class="track-artist artist-link" type="button">${escapeHTML(track.artist)}</button>
      </div>
    </div>
    <div class="track-album">${escapeHTML(track.album)}</div>
    <button class="like-heart ${isLiked(track.id) ? 'liked' : ''}" data-track-id="${escapeHTML(track.id)}" title="Нравится">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.5-4.6-10-9.4C0.6 7.6 2.4 4 6 4c2.1 0 3.6 1.1 4.5 2.4.3.5 1 1.4 1.5 2 .5-.6 1.2-1.5 1.5-2C14.4 5.1 15.9 4 18 4c3.6 0 5.4 3.6 4 7.1-2.5 4.8-10 9.4-10 9.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
    </button>
    <div class="track-duration">${track.local ? escapeHTML(track.extension || 'LOCAL') : fmtTime(track.duration)}</div>
  `;
  row.querySelector('.like-heart').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike(track);
  });
  row.querySelector('.artist-link').addEventListener('click', (e) => {
    e.stopPropagation();
    openArtistProfile(track.artistId, track.artist);
  });
  row.addEventListener('click', () => playTrack(track, queue));
  row.addEventListener('dblclick', () => playTrack(track, queue));
  row.dataset.trackId = String(track.id);
  row.classList.toggle('playing', currentTrack()?.id === track.id && state.playing);
  return row;
}

/* =========================================================
   ЗАГРУЗКА КАТАЛОГА (Deezer)
   ========================================================= */
let localTracks = [];
let localScanInFlight = false;

const catalog = {
  ruMixes: [],       // «Русская сцена» — по одному миксу на артиста
  chartTracks: [],   // мировой топ-чарт (отдельные треки)
  chartAlbums: [],   // мировые популярные альбомы (нужен доп. запрос за треками)
};

async function loadRussianMixes(){
  const mixes = [];
  for(const name of RU_ARTISTS){
    const data = await deezerGet(`/search?q=${encodeURIComponent('artist:"' + name + '"')}&limit=8`);
    const list = data && data.data ? data.data.filter(t => t.preview) : [];
    if(!list.length) continue;
    const tracks = list.map(t => mapTrack(t));
    mixes.push({
      id: 'ru-' + name,
      artistId: list[0].artist && list[0].artist.id,
      artistName: (list[0].artist && list[0].artist.name) || name,
      name: `Топ: ${name}`,
      desc: 'Русская сцена',
      cover: tracks[0].cover,
      tag: pick(TAGS, mixes.length),
      tracks,
    });
  }
  return mixes;
}

async function loadChartTracks(){
  const data = await deezerGet('/chart/0/tracks?limit=20');
  const list = data && data.data ? data.data.filter(t => t.preview) : [];
  return list.map(t => mapTrack(t));
}

async function loadChartAlbums(){
  const data = await deezerGet('/chart/0/albums?limit=10');
  const list = data && data.data ? data.data : [];
  return list.map(a => ({
    id: 'album-' + a.id,
    dzId: a.id,
    name: a.title,
    artist: a.artist ? a.artist.name : '',
    cover: a.cover_medium || a.cover,
    tag: pick(TAGS, a.id),
    tracks: null, // подгрузится лениво при открытии
  }));
}

async function fetchAlbumTracks(collection){
  if(collection.tracks) return collection.tracks;
  const data = await deezerGet(`/album/${collection.dzId}`);
  const list = (data && data.tracks && data.tracks.data) ? data.tracks.data.filter(t => t.preview) : [];
  collection.tracks = list.map(t => mapTrack(t));
  return collection.tracks;
}

/* =========================================================
   ГЛАВНАЯ / БИБЛИОТЕКА / SIDEBAR — рендер после загрузки
   ========================================================= */
function renderSidebarPlaylists(){
  const list = document.getElementById('playlist-list');
  list.innerHTML = '';
  catalog.ruMixes.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'playlist-link';
    btn.innerHTML = `<span class="dot"></span><span class="name">${p.name}</span>`;
    btn.addEventListener('click', () => openCollection(p));
    list.appendChild(btn);
  });
}

function renderHome(){
  const hour = new Date().getHours();
  document.getElementById('greeting-title').textContent =
    hour < 6 ? 'Ночной эфир' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  // hero — обложка и подборка первого доступного русского микса
  const heroMix = catalog.ruMixes[0];
  if(heroMix){
    document.querySelector('.eyebrow').textContent = 'Сейчас в тренде · Deezer · русская сцена';
    document.querySelector('.hero-title').innerHTML = `${heroMix.name}<br/>слушай прямо сейчас`;
    const cover = document.getElementById('hero-cover');
    if(heroMix.cover) cover.style.backgroundImage = `url('${heroMix.cover}')`, cover.style.backgroundSize='cover', cover.style.backgroundPosition='center';
  }

  const quickGrid = document.getElementById('quick-grid');
  quickGrid.innerHTML = '';
  const mix = [...catalog.ruMixes.slice(0,4), ...catalog.chartAlbums.slice(0,2)];
  mix.forEach(item => {
    const el = document.createElement('div');
    el.className = 'quick-card';
    el.innerHTML = `${thumbHTML(item)}<span class="qname">${escapeHTML(item.artistName || item.name)}</span>`;
    el.addEventListener('click', () => item.artistId
      ? openArtistProfile(item.artistId, item.artistName || item.name)
      : openCollection(item));
    quickGrid.appendChild(el);
  });

  renderRail(document.getElementById('rail-made-for-you'), catalog.ruMixes, p =>
    mediaCard({ name:p.artistName || p.name, sub:'Открыть профиль исполнителя', cover:p.cover, tag:p.tag, onClick:()=>openArtistProfile(p.artistId, p.artistName || p.name) }));

  renderRail(document.getElementById('rail-albums'), catalog.chartAlbums, a =>
    mediaCard({ name:a.name, sub:a.artist, cover:a.cover, tag:a.tag, onClick:()=>openCollection(a) }));


  renderRail(document.getElementById('rail-playlists'), catalog.chartTracks.slice(0,12), t =>
    mediaCard({ name:t.title, sub:t.artist, cover:t.cover, tag:t.tag, onClick:()=>playTrack(t, catalog.chartTracks) }));

  // заголовки строк — уточняем под реальные данные
  const titles = document.querySelectorAll('.row-title');
  if(titles[1]) titles[1].textContent = 'Русская сцена';
  if(titles[2]) titles[2].textContent = 'Популярные альбомы (мир)';
  if(titles[3]) titles[3].textContent = 'Треки дня';
}

function renderGenres(){
  const GENRES = [
    {name:'Русский поп', tag:'tg-1'}, {name:'Рэп', tag:'tg-2'}, {name:'Рок', tag:'tg-7'},
    {name:'Электроника', tag:'tg-3'}, {name:'Инди', tag:'tg-5'}, {name:'R&B', tag:'tg-8'},
    {name:'Поп', tag:'tg-4'}, {name:'Джаз', tag:'tg-6'},
  ];
  const grid = document.getElementById('genre-grid');
  grid.innerHTML = '';
  GENRES.forEach(g => {
    const el = document.createElement('div');
    el.className = `genre-card ${g.tag}`;
    el.textContent = g.name;
    el.addEventListener('click', () => {
      document.getElementById('search-input').value = g.name;
      runSearch(g.name);
    });
    grid.appendChild(el);
  });
}

function renderLibrary(){
  const grid = document.getElementById('library-grid');
  grid.innerHTML = '';
  grid.appendChild(likedSongsCard());
  [...catalog.ruMixes, ...catalog.chartAlbums].forEach(item => {
    grid.appendChild(mediaCard({
      name:item.name, sub:item.desc || item.artist, cover:item.cover, tag:item.tag,
      onClick:()=>openCollection(item),
    }));
  });
}

function sortLocalTracks(list, mode){
  return list.slice().sort((a,b) => {
    if(mode === 'modified') return (b.modified || 0) - (a.modified || 0);
    if(mode === 'format') return String(a.extension).localeCompare(String(b.extension)) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title, undefined, { sensitivity:'base' });
  });
}

function renderLocalMusic(){
  const list = document.getElementById('local-track-list');
  const count = document.getElementById('local-music-count');
  const mode = document.getElementById('local-sort')?.value || 'title';
  const tracks = sortLocalTracks(localTracks, mode);
  count.textContent = `${tracks.length} ${pluralTracks(tracks.length)} на компьютере`;
  list.innerHTML = '';
  if(!tracks.length){
    list.innerHTML = '<div class="local-empty"><strong>Локальная музыка не найдена</strong><span>Положи MP3, WAV, FLAC, M4A, OGG или AAC в папку «Музыка» и нажми «Сканировать».</span></div>';
    return;
  }
  tracks.forEach((track, index) => list.appendChild(trackRow(track, index, tracks)));
}

async function loadLocalMusic(){
  if(localScanInFlight || !window.pulseMusic?.scanLocal) return;
  localScanInFlight = true;
  const list = document.getElementById('local-track-list');
  const count = document.getElementById('local-music-count');
  count.textContent = 'Сканирую папки…';
  list.innerHTML = '<div class="local-loading"><span class="btn-spinner"></span>Ищу аудиофайлы в стандартных папках…</div>';
  try{
    localTracks = await window.pulseMusic.scanLocal();
    renderLocalMusic();
  }catch(error){
    localTracks = [];
    count.textContent = 'Не удалось просканировать папки';
    list.innerHTML = '<div class="local-empty"><strong>Не удалось открыть локальную библиотеку</strong><span>Проверь доступ к папкам и попробуй ещё раз.</span></div>';
  }finally{
    localScanInFlight = false;
  }
}

document.getElementById('local-scan-btn')?.addEventListener('click', loadLocalMusic);
document.getElementById('local-sort')?.addEventListener('change', renderLocalMusic);

async function openCollection(collection){
  currentOpenCollectionId = collection.id;
  document.getElementById('playlist-header').innerHTML = `
    ${collectionThumbHTML(collection)}
    <div class="playlist-header-meta">
      <span class="kind">${collection.desc ? 'Плейлист' : 'Альбом'}</span>
      <h1>${collection.name}</h1>
      <span class="sub">${collection.artist || 'Pulse · Deezer'} · загрузка…</span>
    </div>
  `;
  const list = document.getElementById('playlist-tracks');
  list.innerHTML = `<p style="color:var(--text-faint);padding:12px 4px">Загружаю треки…</p>`;
  switchView('playlist');

  const tracks = collection.tracks || await fetchAlbumTracks(collection);
  document.querySelector('#playlist-header .sub').textContent =
    `${collection.artist || 'Pulse · Deezer'} · ${tracks.length} ${pluralTracks(tracks.length)}`;
  list.innerHTML = '';
  if(!tracks.length){
    list.innerHTML = collection.isLiked
      ? `<p style="color:var(--text-faint);padding:12px 4px">Пока нет лайков — нажми на сердечко у любого трека, и он появится здесь.</p>`
      : `<p style="color:var(--text-faint);padding:12px 4px">Превью для этого альбома недоступны.</p>`;
    return;
  }
  tracks.forEach((t, i) => list.appendChild(trackRow(t, i, tracks)));
}

/* =========================================================
   ПОИСК (реальный, через Deezer)
   ========================================================= */
let searchDebounce = null;
function runSearch(query){
  clearTimeout(searchDebounce);
  const wrap = document.getElementById('search-results-wrap');
  const list = document.getElementById('search-results');
  const q = query.trim();
  if(!q){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = `<p style="color:var(--text-faint);padding:12px 4px">Ищу «${q}»…</p>`;
  searchDebounce = setTimeout(async () => {
    const data = await deezerGet(`/search?q=${encodeURIComponent(q)}&limit=25`);
    const results = (data && data.data ? data.data : []).filter(t => t.preview).map(t => mapTrack(t));
    list.innerHTML = '';
    if(!results.length){
      list.innerHTML = `<p style="color:var(--text-faint);padding:12px 4px">Ничего не нашлось по запросу «${q}»</p>`;
      return;
    }
    results.forEach((t,i) => list.appendChild(trackRow(t, i, results)));
  }, 350);
}

/* =========================================================
   НАВИГАЦИЯ / ВИДЫ
   ========================================================= */
function switchView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(`view-${name}`);
  if(target){ target.classList.remove('hidden'); void target.offsetWidth; target.style.animation='none'; void target.offsetWidth; target.style.animation=''; }
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('scroll-area').scrollTop = 0;
  if(name !== 'playlist') currentOpenCollectionId = null;
}
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if(btn.dataset.view === 'wave') startWave();
    else {
      switchView(btn.dataset.view);
      if(btn.dataset.view === 'local-music' && !localTracks.length) loadLocalMusic();
    }
  });
});
document.getElementById('search-input').addEventListener('input', (e) => {
  if(document.getElementById('view-search').classList.contains('hidden')) switchView('search');
  runSearch(e.target.value);
});
document.getElementById('search-bar').addEventListener('click', () => switchView('search'));
document.getElementById('artist-back').addEventListener('click', () => switchView('home'));

/* =========================================================
   ПЛЕЕР — реальное аудио (30-сек превью Deezer)
   ========================================================= */
const audioEl = document.getElementById('audio');
const state = {
  queue: [],
  currentIndex: -1,
  playing: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  volume: 0.75,
  waveMode: false,
};
audioEl.volume = state.volume;

function currentTrack(){ return state.queue[state.currentIndex] || null; }

function playTrack(track, queue){
  if(!track || !track.preview){
    showToast('Для этого трека нет доступного 30-секундного превью.', 'error');
    return;
  }
  state.waveMode = false; // ручной выбор трека выходит из режима «Моя волна»
  state.queue = queue || [track];
  state.currentIndex = Math.max(0, state.queue.findIndex(t => t.id === track.id));
  audioEl.src = track.preview;
  audioEl.currentTime = 0;
  setPlaying(true);
  renderNowPlaying();
  updateQueuePanel();
}

function updatePlayingRows(){
  const id = currentTrack()?.id;
  document.querySelectorAll('.track-row[data-track-id]').forEach(row => {
    row.classList.toggle('playing', state.playing && String(row.dataset.trackId) === String(id));
  });
}

function setPlaying(val){
  state.playing = val;
  if(val){
    audioEl.play().catch(() => {
      state.playing = false;
      showToast('Не удалось начать воспроизведение. Проверь соединение.', 'error');
      updatePlayingRows();
    });
  } else { audioEl.pause(); }
  document.getElementById('icon-play').classList.toggle('hidden', val);
  document.getElementById('icon-pause').classList.toggle('hidden', !val);
  document.getElementById('now-cover').classList.toggle('active', val);
  updatePlayingRows();
  renderWaveNow();
}

audioEl.addEventListener('timeupdate', updateSeekUI);
audioEl.addEventListener('loadedmetadata', updateSeekUI);
audioEl.addEventListener('ended', () => goNext(true));
audioEl.addEventListener('error', () => {
  state.playing = false;
  setPlaying(false);
  showToast('Превью временно недоступно. Попробуй другой трек.', 'error');
});
audioEl.addEventListener('waiting', () => document.getElementById('now-cover').classList.add('buffering'));
audioEl.addEventListener('playing', () => document.getElementById('now-cover').classList.remove('buffering'));

function goNext(auto=false){
  if(state.waveMode){ advanceWave(); return; }
  if(!state.queue.length) return;
  let next;
  if(state.shuffle){
    next = Math.floor(Math.random() * state.queue.length);
  } else {
    next = state.currentIndex + 1;
    if(next >= state.queue.length){
      if(state.repeat === 'all'){ next = 0; }
      else { setPlaying(false); return; }
    }
  }
  state.currentIndex = next;
  const t = currentTrack();
  if(!t) return;
  if(state.repeat === 'one' && auto){
    audioEl.currentTime = 0; audioEl.play().catch(()=>{}); return;
  }
  audioEl.src = t.preview;
  audioEl.currentTime = 0;
  renderNowPlaying();
  setPlaying(true);
}

function goPrev(){
  if(!state.queue.length) return;
  if(audioEl.currentTime > 3){ audioEl.currentTime = 0; return; }
  if(state.waveMode){
    if(state.currentIndex <= 0){ audioEl.currentTime = 0; return; }
    state.currentIndex--;
    const t = currentTrack();
    audioEl.src = t.preview; audioEl.currentTime = 0;
    renderNowPlaying(); setPlaying(true);
    return;
  }
  let prev = state.currentIndex - 1;
  if(prev < 0) prev = state.repeat === 'all' ? state.queue.length - 1 : 0;
  state.currentIndex = prev;
  const t = currentTrack();
  if(!t) return;
  audioEl.src = t.preview;
  audioEl.currentTime = 0;
  renderNowPlaying();
  setPlaying(true);
}

function renderNowPlaying(){
  const track = currentTrack();
  const cover = document.getElementById('now-cover');
  if(!track){
    document.getElementById('now-title').textContent = 'Выбери трек';
    document.getElementById('now-artist').textContent = '—';
    cover.className = 'now-cover';
    cover.innerHTML = '<div class="eq-bars" id="eq-bars"><span></span><span></span><span></span><span></span></div>';
    return;
  }
  document.getElementById('now-title').textContent = track.title;
  document.getElementById('now-artist').textContent = track.artist;
  cover.className = `now-cover ${track.tag || ''}`;
  cover.style.backgroundImage = track.cover ? `url('${track.cover}')` : '';
  cover.style.backgroundSize = 'cover';
  cover.style.backgroundPosition = 'center';
  cover.innerHTML = '<div class="eq-bars" id="eq-bars"><span></span><span></span><span></span><span></span></div>';
  cover.classList.toggle('active', state.playing);
  updateSeekUI();
  updateLikeBtn();
  renderWaveNow();
}

/* =========================================================
   МОЯ ВОЛНА — бесконечное радио: подбор + лайк/дизлайк
   ========================================================= */
const wave = {
  disliked: new Set(),   // id треков, отклонённых в этой сессии волны
  seenIds: new Set(),    // id, уже добавленных в очередь (без повторов)
};
let waveArtistCursor = 0;
let waveArtistPool = [];

async function fetchFavoriteWaveTracks(){
  const tracks = [];
  for(const name of favoriteArtists){
    const data = await deezerGet(`/search?q=${encodeURIComponent('artist:"' + name + '"')}&limit=8`);
    const list = data && data.data ? data.data.filter(t => t.preview).map(t => mapTrack(t)) : [];
    tracks.push(...list);
  }
  return shuffleArray(tracks);
}

function buildWavePoolCandidates(){
  const pool = [];
  // После первичного онбординга лайки становятся самым сильным сигналом.
  pool.push(...Array.from(likedTracks.values()));
  catalog.ruMixes.forEach(m => pool.push(...m.tracks));
  pool.push(...catalog.chartTracks);
  const map = new Map();
  pool.forEach(t => { if(!map.has(t.id)) map.set(t.id, t); });
  const unique = Array.from(map.values());
  const liked = unique.filter(t => isLiked(t.id));
  const rest = shuffleArray(unique.filter(t => !isLiked(t.id)));
  return [...shuffleArray(liked), ...rest];
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchMoreWaveTracks(){
  const name = waveArtistPool.length
    ? waveArtistPool[waveArtistCursor % waveArtistPool.length]
    : EXTRA_WAVE_ARTISTS[waveArtistCursor % EXTRA_WAVE_ARTISTS.length];
  waveArtistCursor++;
  const data = await deezerGet(`/search?q=${encodeURIComponent('artist:"' + name + '"')}&limit=10`);
  const list = data && data.data ? data.data.filter(t => t.preview) : [];
  return list.map(t => mapTrack(t));
}

async function ensureWaveQueue(minAhead = 5){
  let attempts = 0;
  while(state.queue.length - (state.currentIndex + 1) < minAhead && attempts < 5){
    attempts++;
    let batch = buildWavePoolCandidates().filter(t => !wave.seenIds.has(t.id) && !wave.disliked.has(t.id));
    if(!batch.length){
      batch = (await fetchMoreWaveTracks()).filter(t => !wave.seenIds.has(t.id) && !wave.disliked.has(t.id));
    }
    if(!batch.length) break;
    batch.slice(0, 10).forEach(t => { wave.seenIds.add(t.id); state.queue.push(t); });
  }
}

async function startWave(){
  switchView('wave');
  if(state.waveMode && currentTrack()){
    renderWaveNow();
    return; // волна уже играет — просто открываем экран
  }
  state.waveMode = true;
  state.queue = [];
  state.currentIndex = -1;
  wave.seenIds.clear();
  waveArtistCursor = 0;
  waveArtistPool = favoriteArtists.length ? [...favoriteArtists, ...EXTRA_WAVE_ARTISTS] : EXTRA_WAVE_ARTISTS;
  setWaveStatus(favoriteArtists.length ? `Настраиваю волну под: ${favoriteArtists.slice(0, 3).join(', ')}…` : 'Подбираю треки под твою волну…');
  document.getElementById('wave-title').textContent = 'Подбираю треки…';
  document.getElementById('wave-artist').textContent = '';
  if(favoriteArtists.length){
    const preferred = (await fetchFavoriteWaveTracks()).filter(t => !wave.seenIds.has(t.id));
    preferred.slice(0, 12).forEach(t => { wave.seenIds.add(t.id); state.queue.push(t); });
  }
  await ensureWaveQueue(8);
  await advanceWave();
}

async function advanceWave(){
  state.currentIndex++;
  await ensureWaveQueue(5);
  const t = state.queue[state.currentIndex];
  if(!t){
    setWaveStatus('Не получилось загрузить треки — проверь интернет-соединение.');
    setPlaying(false);
    return;
  }
  audioEl.src = t.preview;
  audioEl.currentTime = 0;
  renderNowPlaying();
  setPlaying(true);
  updateQueuePanel();
}

function waveDislike(){
  const t = currentTrack();
  if(!t || !state.waveMode) return;
  wave.disliked.add(t.id);
  advanceWave();
}

function waveLike(){
  const t = currentTrack();
  if(!t) return;
  toggleLike(t);
}

function setWaveStatus(msg){
  const el = document.getElementById('wave-status');
  if(el) el.textContent = msg;
}

function renderWaveNow(){
  const cover = document.getElementById('wave-cover');
  if(!cover) return; // разметка ещё не готова (не должно случаться)
  const t = currentTrack();
  const waveViewEl = document.getElementById('view-wave');
  const waveViewOpen = waveViewEl && !waveViewEl.classList.contains('hidden');
  if(t && (state.waveMode || waveViewOpen)){
    cover.style.backgroundImage = t.cover ? `url('${t.cover}')` : '';
    cover.style.backgroundSize = 'cover';
    cover.style.backgroundPosition = 'center';
    document.getElementById('wave-title').textContent = t.title;
    document.getElementById('wave-artist').textContent = t.artist;
    if(state.waveMode) setWaveStatus('');
    document.getElementById('wave-like').classList.toggle('liked', isLiked(t.id));
  }
  document.getElementById('wave-icon-play').classList.toggle('hidden', state.playing);
  document.getElementById('wave-icon-pause').classList.toggle('hidden', !state.playing);
  document.getElementById('wave-bars').classList.toggle('active', state.playing);
}

document.getElementById('wave-playpause').addEventListener('click', () => {
  if(!currentTrack()) return;
  setPlaying(!state.playing);
});
document.getElementById('wave-dislike').addEventListener('click', waveDislike);
document.getElementById('wave-like').addEventListener('click', waveLike);

function updateSeekUI(){
  const dur = audioEl.duration || currentTrack()?.duration || 0;
  const cur = audioEl.currentTime || 0;
  const pct = dur ? Math.min(100, (cur/dur)*100) : 0;
  document.getElementById('seek-fill').style.width = pct + '%';
  document.getElementById('seek-thumb').style.left = pct + '%';
  document.getElementById('time-current').textContent = fmtTime(cur);
  document.getElementById('time-total').textContent = fmtTime(dur);
}

function updateLikeBtn(){
  const track = currentTrack();
  document.getElementById('like-btn').classList.toggle('liked', !!track && isLiked(track.id));
}

function updateQueuePanel(){
  const list = document.getElementById('queue-list');
  list.innerHTML = '';
  state.queue.slice(state.currentIndex + 1, state.currentIndex + 21).forEach(t => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `${thumbHTML(t)}<div><div class="queue-item-name">${t.title}</div><div class="queue-item-artist">${t.artist}</div></div>`;
    el.addEventListener('click', () => playTrack(t, state.queue));
    list.appendChild(el);
  });
  if(!state.queue.length){
    list.innerHTML = '<p style="color:var(--text-faint);padding:10px 4px">Очередь пуста</p>';
  }
}

/* --- controls wiring --- */
document.getElementById('btn-play').addEventListener('click', () => {
  if(!currentTrack()){
    const first = catalog.chartTracks[0] || catalog.ruMixes[0]?.tracks?.[0];
    if(first) playTrack(first, catalog.chartTracks.length ? catalog.chartTracks : [first]);
    return;
  }
  setPlaying(!state.playing);
});
document.getElementById('btn-next').addEventListener('click', () => goNext());
document.getElementById('btn-prev').addEventListener('click', () => goPrev());
document.getElementById('btn-shuffle').addEventListener('click', (e) => {
  state.shuffle = !state.shuffle;
  e.currentTarget.classList.toggle('active', state.shuffle);
});
document.getElementById('btn-repeat').addEventListener('click', (e) => {
  const order = ['off','all','one'];
  state.repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
  e.currentTarget.classList.toggle('active', state.repeat !== 'off');
  e.currentTarget.dataset.mode = state.repeat;
  e.currentTarget.title = state.repeat === 'one' ? 'Повторять трек' : state.repeat === 'all' ? 'Повторять очередь' : 'Повтор выключен';
});
document.getElementById('like-btn').addEventListener('click', () => {
  const track = currentTrack();
  if(!track) return;
  toggleLike(track);
});
document.getElementById('btn-queue').addEventListener('click', () => {
  document.getElementById('queue-panel').classList.toggle('hidden');
});
document.getElementById('queue-close').addEventListener('click', () => {
  document.getElementById('queue-panel').classList.add('hidden');
});
document.addEventListener('click', (event) => {
  const panel = document.getElementById('queue-panel');
  const trigger = document.getElementById('btn-queue');
  if(!panel.classList.contains('hidden') && !panel.contains(event.target) && !trigger.contains(event.target)) panel.classList.add('hidden');
});

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  if(event.code === 'Space'){
    event.preventDefault();
    document.getElementById('btn-play').click();
  } else if(event.code === 'ArrowRight'){
    event.preventDefault();
    if(currentTrack()) audioEl.currentTime = Math.min(audioEl.duration || 30, audioEl.currentTime + 5);
  } else if(event.code === 'ArrowLeft'){
    event.preventDefault();
    if(currentTrack()) audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
  } else if(event.key.toLowerCase() === 'm'){
    state.volume = state.volume > 0 ? 0 : 0.75;
    audioEl.volume = state.volume;
    document.getElementById('volume-fill').style.width = (state.volume * 100) + '%';
    document.getElementById('volume-thumb').style.left = (state.volume * 100) + '%';
  } else if(event.key.toLowerCase() === 'l' && currentTrack()) toggleLike(currentTrack());
  else if(event.key === 'Escape') document.getElementById('queue-panel').classList.add('hidden');
});
document.querySelector('.notif-btn')?.addEventListener('click', () => {
  showToast('Новых уведомлений нет — ты всё прослушал.', 'default');
});

document.getElementById('btn-new-playlist')?.addEventListener('click', () => {
  const name = window.prompt('Название нового плейлиста');
  if(name && name.trim()) showToast(`Плейлист «${name.trim()}» можно наполнить лайками из очереди.`);
});

document.getElementById('hero-play').addEventListener('click', () => {
  const heroMix = catalog.ruMixes[0];
  if(heroMix && heroMix.tracks.length) playTrack(heroMix.tracks[0], heroMix.tracks);
});

function bindSeekLike(trackEl, fillEl, thumbEl, onChange){
  let dragging = false;
  const setFromEvent = (e) => {
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    fillEl.style.width = (pct*100) + '%';
    thumbEl.style.left = (pct*100) + '%';
    onChange(pct);
  };
  trackEl.addEventListener('mousedown', (e) => { dragging = true; setFromEvent(e); });
  window.addEventListener('mousemove', (e) => { if(dragging) setFromEvent(e); });
  window.addEventListener('mouseup', () => dragging = false);
}

bindSeekLike(
  document.getElementById('seek-track'),
  document.getElementById('seek-fill'),
  document.getElementById('seek-thumb'),
  (pct) => {
    if(!audioEl.duration) return;
    audioEl.currentTime = pct * audioEl.duration;
  }
);

bindSeekLike(
  document.getElementById('volume-track'),
  document.getElementById('volume-fill'),
  document.getElementById('volume-thumb'),
  (pct) => {
    state.volume = pct;
    audioEl.volume = pct;
    document.getElementById('volume-icon').style.opacity = pct === 0 ? '0.4' : '1';
  }
);
document.getElementById('volume-fill').style.width = (state.volume*100)+'%';
document.getElementById('volume-thumb').style.left = (state.volume*100)+'%';

/* =========================================================
   ОКНО (кастомный титлбар — win/linux)
   ========================================================= */
if(window.pulseWindow){
  document.getElementById('btn-min').addEventListener('click', () => window.pulseWindow.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.pulseWindow.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.pulseWindow.close());
  if(window.pulseWindow.platform === 'darwin'){
    document.getElementById('titlebar').style.display = 'none';
  }
}

/* =========================================================
   СТАРТОВАЯ АНИМАЦИЯ
   ========================================================= */
function dismissLaunchScreen(){
  const screen = document.getElementById('launch-screen');
  if(!screen || screen.classList.contains('is-leaving')) return;
  screen.classList.add('is-leaving');
  window.setTimeout(() => screen.remove(), 700);
}

window.setTimeout(dismissLaunchScreen, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 680);

/* =========================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================= */
async function init(){
  skeletonRail(document.getElementById('rail-made-for-you'));
  skeletonRail(document.getElementById('rail-albums'));
  skeletonRail(document.getElementById('rail-playlists'));

  const [ruMixes, chartTracks, chartAlbums] = await Promise.all([
    loadRussianMixes(),
    loadChartTracks(),
    loadChartAlbums(),
  ]);
  catalog.ruMixes = ruMixes;
  catalog.chartTracks = chartTracks;
  catalog.chartAlbums = chartAlbums;

  renderSidebarPlaylists();
  renderHome();
  renderGenres();
  renderLibrary();
  updateQueuePanel();
  showArtistOnboarding();
}

/* =========================================================
   АВТОРИЗАЦИЯ (Firebase Auth email/пароль + гостевой режим)
   ========================================================= */
let appBooted = false;

function bootAppOnce(){
  if(appBooted) return;
  appBooted = true;
  init();
}

async function checkForPulseUpdate(silent = false){
  const button = document.getElementById('btn-check-update');
  if(!window.pulseMusic?.checkForUpdate) return;
  if(button){ button.disabled = true; button.textContent = 'Проверяю…'; }
  try{
    const result = await window.pulseMusic.checkForUpdate();
    if(!result.supported){ if(!silent) showToast('Автообновление доступно в Windows-сборке Pulse.'); return; }
    if(!result.available){ if(!silent) showToast('Установлена последняя версия Pulse.'); return; }
    const shouldDownload = window.confirm(`Доступна Pulse ${result.version}. Скачать обновление сейчас?`);
    if(!shouldDownload) return;
    if(button) button.textContent = 'Скачиваю…';
    const downloaded = await window.pulseMusic.downloadUpdate({ url:result.url, sha256:result.sha256, version:result.version });
    if(!downloaded.ok){ showToast(downloaded.error || 'Не удалось скачать обновление.', 'error'); return; }
    const shouldInstall = window.confirm('Обновление скачано. Pulse закроется и запустит установщик. Продолжить?');
    if(shouldInstall){
      const installed = await window.pulseMusic.installUpdate(downloaded.filePath);
      if(!installed.ok) showToast(installed.error || 'Не удалось запустить установщик.', 'error');
    }
  }catch(error){
    if(!silent) showToast('Не удалось проверить обновления.', 'error');
  }finally{
    if(button){ button.disabled = false; button.textContent = 'Проверить обновления'; }
  }
}

function showApp(displayName, email, uid){
  currentUserId = uid || email || 'guest';
  loadLikedFromStorage();
  loadFavoriteArtists();
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('shell').classList.remove('hidden');
  document.getElementById('player-bar').classList.remove('hidden');
  const initial = (displayName || email || '?').trim().charAt(0).toUpperCase() || '?';
  document.getElementById('avatar-btn').textContent = initial;
  document.getElementById('account-email').textContent = email || 'Гостевой режим';
  refreshLikeUI();
  bootAppOnce();
  window.setTimeout(() => checkForPulseUpdate(true), 2500);
}

function showAuthScreen(){
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('shell').classList.add('hidden');
  document.getElementById('player-bar').classList.add('hidden');
  document.getElementById('account-dropdown').classList.add('hidden');
}

window.addEventListener('pulse-auth-changed', (e) => {
  const user = e.detail && e.detail.user;
  if(user){
    showApp(user.displayName, user.email, user.uid);
  } else {
    currentUserId = null;
    showAuthScreen();
  }
});
window.addEventListener('pulse-auth-unconfigured', () => {
  document.getElementById('auth-config-warning').classList.remove('hidden');
});

/* --- переключение вкладок вход/регистрация --- */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isSignin = tab.dataset.tab === 'signin';
    document.getElementById('form-signin').classList.toggle('hidden', !isSignin);
    document.getElementById('form-signup').classList.toggle('hidden', isSignin);
  });
});

function setFormLoading(submitId, loading){
  const btn = document.getElementById(submitId);
  btn.querySelector('.btn-label').classList.toggle('hidden', loading);
  btn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
  btn.disabled = loading;
}
function showFormError(errorId, message){
  const el = document.getElementById(errorId);
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

document.getElementById('form-signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  showFormError('signin-error', '');
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  setFormLoading('signin-submit', true);
  try{
    await window.PulseAuth.signIn(email, password);
    // дальше подхватит onAuthStateChanged → событие pulse-auth-changed
  }catch(err){
    showFormError('signin-error', err.message || window.PulseAuth.friendlyError(err));
  }finally{
    setFormLoading('signin-submit', false);
  }
});

document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  showFormError('signup-error', '');
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  setFormLoading('signup-submit', true);
  try{
    await window.PulseAuth.signUp(email, password, name);
  }catch(err){
    showFormError('signup-error', err.message || window.PulseAuth.friendlyError(err));
  }finally{
    setFormLoading('signup-submit', false);
  }
});

document.getElementById('btn-forgot').addEventListener('click', async () => {
  const email = document.getElementById('signin-email').value.trim();
  if(!email){ showFormError('signin-error', 'Сначала введи email вверху формы.'); return; }
  try{
    await window.PulseAuth.resetPassword(email);
    showFormError('signin-error', '');
    alert(`Письмо для сброса пароля отправлено на ${email}`);
  }catch(err){
    showFormError('signin-error', err.message || window.PulseAuth.friendlyError(err));
  }
});

document.getElementById('btn-guest').addEventListener('click', () => {
  showApp('Гость', null, 'guest');
});

/* --- меню аккаунта --- */
document.getElementById('avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('account-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('account-dropdown').classList.add('hidden');
});
document.getElementById('btn-signout').addEventListener('click', async () => {
  await window.PulseAuth.signOutUser();
  showAuthScreen();
});
document.getElementById('btn-check-update')?.addEventListener('click', (event) => {
  event.stopPropagation();
  checkForPulseUpdate(false);
});

// Если Firebase не настроен — сразу показываем предупреждение
// (событие pulse-auth-unconfigured может прийти раньше, чем этот
// слушатель зарегистрируется, поэтому дублируем проверку здесь).
if(window.PulseAuth && !window.PulseAuth.isConfigured){
  document.getElementById('auth-config-warning').classList.remove('hidden');
}
