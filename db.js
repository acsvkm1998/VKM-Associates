/* db.js — VKM Associates persistent storage (IndexedDB + localStorage) */
(() => {
  const DB_NAME = 'vkmDB';
  const DB_VERSION = 1;
  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Products: physical items (stationery, furniture, etc.)
        if (!db.objectStoreNames.contains('products')) {
          const store = db.createObjectStore('products', { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        // Media: images/logos as blobs
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'id' });
        }
        // Settings: key/value like logoMediaId, business info
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        // Users: optional store (owner account)
        if (!db.objectStoreNames.contains('users')) {
          const users = db.createObjectStore('users', { keyPath: 'username' });
          // Seed owner account
          users.put({
            username: 'VKM2009',
            password: 'VKM1998',
            role: 'owner',
            createdAt: Date.now()
          });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeNames, mode = 'readonly') {
    const t = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    const map = {};
    stores.forEach(name => map[name] = t.objectStore(name));
    return { t, ...map };
  }

  // ---- Media (images/logos) ----
  async function saveMedia(file) {
    const id = crypto?.randomUUID ? crypto.randomUUID() : 'm_' + Date.now();
    const record = {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
      createdAt: Date.now()
    };
    const { t, media } = tx('media', 'readwrite');
    await request(media.put(record));
    return id;
  }

  async function getMediaUrl(id) {
    const { media } = tx('media', 'readonly');
    const rec = await request(media.get(id));
    if (!rec) return null;
    return URL.createObjectURL(rec.blob);
  }

  async function setLogo(file) {
    const mediaId = await saveMedia(file);
    const { settings } = tx('settings', 'readwrite');
    await request(settings.put({ key: 'logoMediaId', value: mediaId }));
    return mediaId;
  }

  async function getLogoUrl() {
    const { settings } = tx('settings', 'readonly');
    const row = await request(settings.get('logoMediaId'));
    return row ? getMediaUrl(row.value) : null;
  }

  // ---- Products (inventory) ----
  async function addProduct(p) {
    const id = p.id || (crypto?.randomUUID ? crypto.randomUUID() : 'p_' + Date.now());
    const product = {
      id,
      name: p.name,
      category: p.category || 'Stationery',
      price: Number(p.price || 0),
      stock: Number.isFinite(p.stock) ? Number(p.stock) : 0,
      imageMediaId: p.imageMediaId || null,
      description: p.description || '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const { products } = tx('products', 'readwrite');
    await request(products.put(product));
    return product;
  }

  async function updateProduct(id, updates) {
    const { products } = tx('products', 'readwrite');
    const existing = await request(products.get(id));
    if (!existing) throw new Error('Product not found');
    const next = { ...existing, ...updates, updatedAt: Date.now() };
    await request(products.put(next));
    return next;
  }

  async function deleteProduct(id) {
    const { products } = tx('products', 'readwrite');
    await request(products.delete(id));
  }

  async function listProducts(filter = {}) {
    const { products } = tx('products', 'readonly');
    const all = await request(products.getAll());
    return all
      .filter(p => !filter.category || p.category === filter.category)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- Settings / Business info ----
  async function setBusinessInfo(info) {
    const { settings } = tx('settings', 'readwrite');
    await request(settings.put({ key: 'business', value: info }));
  }
  async function getBusinessInfo() {
    const { settings } = tx('settings', 'readonly');
    const row = await request(settings.get('business'));
    return row?.value || null;
  }

  // ---- Owner login (localStorage session) ----
  async function loginOwner(username, password) {
    const { users } = tx('users', 'readonly');
    const user = await request(users.get(username));
    const ok = Boolean(user && user.password === password && user.role === 'owner');
    if (ok) localStorage.setItem('vkm_owner_logged_in', '1');
    return ok;
  }
  function logoutOwner() { localStorage.removeItem('vkm_owner_logged_in'); }
  function isOwner() { return localStorage.getItem('vkm_owner_logged_in') === '1'; }

  // ---- Small helper for IDB requests -> Promise ----
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  // ---- Public API ----
  async function init() {
    if (!db) await openDB();
    // Seed business info if missing
    const existing = await getBusinessInfo();
    if (!existing) {
      await setBusinessInfo({
        name: 'VKM Associates',
        owner: 'Manorma Sharma',
        address: 'Siwala Adalhat, Mirzapur, Uttar Pradesh',
        coords: { lat: 25.083, lng: 82.777 } // approximate; adjust in Contact page
      });
    }
    return true;
  }

  window.VKM = {
    // lifecycle
    init,
    // media
    saveMedia, getMediaUrl, setLogo, getLogoUrl,
    // products
    addProduct, updateProduct, deleteProduct, listProducts,
    // settings
    setBusinessInfo, getBusinessInfo,
    // auth
    loginOwner, logoutOwner, isOwner
  };
})();
