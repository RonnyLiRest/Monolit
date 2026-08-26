/* МОНОЛИТ — script.js */

/* ---------- Подключение Supabase ---------- */
const SUPABASE_URL = "https://dqyriglzrrjaicfctahn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vDwf9v7dmv5OB-n__OER7Q_77m7cqCd";

const db = (typeof supabase !== "undefined")
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!db) {
  console.warn("Supabase не настроен.");
}

/* ---------- Хеширование пароля (Web Crypto API, без внешних библиотек) ----------
   SHA-256 со случайной солью на каждого пользователя. Сравнение пароля происходит 
   в браузере, то есть password_hash доступен через публичный ключ — в реальном 
   приложении эту логику вынесли бы на сервер (например, в Supabase Edge Function). */
function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Координаты склада 
const WAREHOUSE = { lat: 59.9721, lon: 30.4173, name: "МОНОЛИТ, Индустриальный пр., 14" };

const FREE_KM = 3;

// Тарифная сетка по типу транспорта.
const VEHICLE_TIERS = [
  { id: "t07", type: "Грузовик",     capacity: "0.7 т", baseFee: 500,  ratePerKm: 35 },
  { id: "t35", type: "Грузовик",     capacity: "3.5 т", baseFee: 900,  ratePerKm: 45 },
  { id: "t6",  type: "Грузовик",     capacity: "6 т",   baseFee: 1400, ratePerKm: 55 },
  { id: "t10", type: "Грузовик",     capacity: "10 т",  baseFee: 2000, ratePerKm: 65 },
  { id: "m5",  type: "Манипулятор",  capacity: "5 т",   baseFee: 1800, ratePerKm: 60 },
  { id: "m10", type: "Манипулятор",  capacity: "10 т",  baseFee: 2600, ratePerKm: 75 },
];

// Граница зоны доставки 
const DELIVERY_ZONE_POINTS = [
  [60.71, 28.75],  // Выборг
  [60.95, 29.13],  // Каменогорск
  [61.00, 29.41],  // Михалево
  [61.04, 30.13],  // Приозерск
  [61.02, 30.23],  // Побережье Ладоги
  [60.73, 30.53],
  [59.90, 31.18],
  [59.90, 31.47],
  [59.94, 31.56],
  [60.06, 31.50],
  [60.22, 31.69],
  [60.20, 32.05],
  [60.12, 32.31],  // северо-восток, район Новой Ладоги
  [59.92, 32.33],  // Волхов
  [59.45, 32.02],          // Кириши
  [59.10, 31.70],  // Чудово
  [58.71, 29.85],  // Луга
  [58.95, 29.66],
  [59.04, 28.72],
  [59.37, 28.56],  // Кингисепп
  [59.59, 28.72],  // Котельский
  [59.89, 29.05],  // Район Соснового Бора
  [59.96, 29.07],
  [59.98, 29.22],
  [59.93, 29.65],   // У дамбы юг
  [60.03, 29.63],  // Крестовский
  [60.03, 29.96],  // у дамбы север
  [60.06, 29.96],  // Вокруг сестрорецка
  [60.07, 29.95],
  [60.08, 29.91],
  [60.09, 29.93],
  [60.14, 29.92],  // У поворота
  [60.20, 29.56],  // После Зеленогорска
  [60.16, 29.42],
  [60.18, 29.01],  // Бухты
  [60.37, 28.60]   // Приморск
];

// Расстояние между двумя точками на сфере (формула гаверсинуса), в км
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Стоимость доставки: база тарифа + (расстояние − бесплатные км) × цена за км.
function calculateDeliveryCost(distanceKm, tierId) {
  const tier = VEHICLE_TIERS.find(t => t.id === tierId) || VEHICLE_TIERS[0];
  const billableKm = Math.max(0, distanceKm - FREE_KM);
  return Math.round(tier.baseFee + billableKm * tier.ratePerKm);
}

// Полигон зоны доставки — создаётся один раз, как только загрузится Yandex Maps
// API, и доступен на любой странице (не только на Delivery.html), потому что
// он же нужен форме оформления заказа в корзине для проверки адреса.
let deliveryZonePolygon = null;

if (typeof ymaps !== "undefined") {
  ymaps.ready(initYandexMaps);
} else {
  console.warn("Yandex Maps API не загрузился — проверьте API-ключ в теге <script> на странице.");
}

function initYandexMaps() {
  deliveryZonePolygon = new ymaps.Polygon(
    [DELIVERY_ZONE_POINTS],
    {},
    {
      fillColor: "rgba(255,90,31,0.06)",
      strokeColor: "#FF5A1F",
      strokeWidth: 3,
      strokeStyle: "solid",
      interactive: false
    }
  );

  /* Delivery.html — калькулятор доставки */
  const deliveryForm = document.getElementById("delivery-form");
  if (deliveryForm) {
    const map = new ymaps.Map("delivery-map", {
      center: [WAREHOUSE.lat, WAREHOUSE.lon],
      zoom: 7,
      controls: ["zoomControl"]
    });

    map.geoObjects.add(new ymaps.Placemark(
      [WAREHOUSE.lat, WAREHOUSE.lon],
      { hintContent: "Склад МОНОЛИТ" },
      { preset: "islands#darkOrangeDotIcon" }
    ));

    map.geoObjects.add(deliveryZonePolygon);
    map.setBounds(deliveryZonePolygon.geometry.getBounds(), { checkZoomRange: true });

    // Выбор тарифа транспорта
    let selectedTier = VEHICLE_TIERS[0].id;
    document.querySelectorAll(".vehicle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".vehicle-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTier = btn.dataset.tier;
      });
    });

    let destPlacemark = null;
    let routeLine = null;

    // Общая функция для отрисовки результата 
    function processCoordinates(coords, addressText) {
      const errorBox = document.getElementById("delivery-error");
      const resultBox = document.getElementById("delivery-result");
      errorBox.classList.remove("show");

      if (!deliveryZonePolygon.geometry.contains(coords)) {
        errorBox.textContent = "Эта точка за пределами зоны доставки";
        errorBox.classList.add("show");
        resultBox.classList.remove("show");
        return;
      }

      document.getElementById("delivery-address").value = addressText;

      if (destPlacemark) map.geoObjects.remove(destPlacemark);
      if (routeLine) map.geoObjects.remove(routeLine);

      destPlacemark = new ymaps.Placemark(coords, { hintContent: "Адрес доставки" }, { preset: "islands#darkGreenDotIcon" });
      routeLine = new ymaps.Polyline(
        [[WAREHOUSE.lat, WAREHOUSE.lon], coords],
        {},
        { strokeColor: "#191B1D", strokeWidth: 2, strokeStyle: "shortdash" }
      );
      map.geoObjects.add(destPlacemark);
      map.geoObjects.add(routeLine);
      map.setBounds(routeLine.geometry.getBounds(), { checkZoomRange: true, zoomMargin: 50 });

      const distanceKm = haversineDistanceKm(WAREHOUSE.lat, WAREHOUSE.lon, coords[0], coords[1]);
      const cost = calculateDeliveryCost(distanceKm, selectedTier);
      document.getElementById("res-distance").textContent = distanceKm.toFixed(1) + " км";
      document.getElementById("res-cost").textContent = cost.toLocaleString("ru-RU") + " ₽";
      resultBox.classList.add("show");
    }

    // Клик по карте: сразу ставим метку, а адрес подтягиваем в фоне
    map.events.add("click", function (e) {
      const coords = e.get("coords"); // [lat, lon]
      processCoordinates(coords, "Определяем адрес...");

      ymaps.geocode(coords).then(function (res) {
        const found = res.geoObjects.get(0);
        if (found) {
          document.getElementById("delivery-address").value = found.properties.get("name");
        }
      }).catch(function (err) {
        console.warn("Не удалось определить адрес по клику:", err);
      });
    });

    // Ручной ввод адреса 
    deliveryForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const addressInput = document.getElementById("delivery-address");
      const errorBox = document.getElementById("delivery-error");
      const submitBtn = deliveryForm.querySelector("button[type=submit]");

      errorBox.classList.remove("show");

      const address = addressInput.value.trim();
      if (!address) {
        errorBox.textContent = "Введите адрес или кликните по карте";
        errorBox.classList.add("show");
        return;
      }

      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Считаем...";
      submitBtn.disabled = true;

      const query = address.toLowerCase().includes("санкт-петербург") ? address : address + ", Санкт-Петербург";

      ymaps.geocode(query, { results: 1 }).then(function (res) {
        const found = res.geoObjects.get(0);
        if (!found) throw new Error("Адрес не найден — уточните улицу и номер дома");

        const coords = found.geometry.getCoordinates();
        processCoordinates(coords, found.properties.get("name"));

        // Сброс кнопки, иначе он срабатывает, не дожидаясь ответа сервера
        submitBtn.textContent = originalLabel;
        submitBtn.disabled = false;

      }).catch(function (err) {
        errorBox.textContent = err.message || "Не удалось рассчитать доставку";
        errorBox.classList.add("show");
        submitBtn.textContent = originalLabel;
        submitBtn.disabled = false;
      });
    });
  }

  /* Contacts.html — карта склада */
  const warehouseMapEl = document.getElementById("warehouse-map");
  if (warehouseMapEl) {
    const wmap = new ymaps.Map("warehouse-map", {
      center: [WAREHOUSE.lat, WAREHOUSE.lon],
      zoom: 14,
      controls: ["zoomControl"]
    });
    wmap.geoObjects.add(new ymaps.Placemark(
      [WAREHOUSE.lat, WAREHOUSE.lon],
      { hintContent: "Склад МОНОЛИТ", balloonContent: "Индустриальный пр., 14" },
      { preset: "islands#darkOrangeDotIcon" }
    ));
  }

  /* ВСПОМОГАТЕЛЬНАЯ НЕВИДИМАЯ КАРТА ДЛЯ РАСЧЕТОВ В КОРЗИНЕ  */
  // Если это не страница Доставки (нет deliveryForm), и полигон уже создан:
  if (!deliveryForm && deliveryZonePolygon) {
    const hiddenContainer = document.getElementById("hidden-yandex-map");
    
    if (hiddenContainer) {
      // Создаем карту прямо на этом скрытом блоке
      const hiddenMap = new ymaps.Map("hidden-yandex-map", {
        center: [WAREHOUSE.lat, WAREHOUSE.lon],
        zoom: 7
      }, {
        suppressMapOpenBlock: true, // Подавляем лишние проверки
        restrictMapBounds: true
      });
      
      // Регистрируем полигон на этой карте
      hiddenMap.geoObjects.add(deliveryZonePolygon);
    }
  }
}

/* МОДАЛЬНЫЕ ОКНА: открытие/закрытие (общие для авторизации и корзины) */
function openModal(modal) {
  if (!modal) return;
  document.getElementById("modal-overlay").classList.add("open");
  modal.classList.add("open");
}
function closeModal(modal) {
  if (!modal) return;
  document.getElementById("modal-overlay").classList.remove("open");
  modal.classList.remove("open");
}
function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
}
function clearFieldErrors(form) {
  form.querySelectorAll(".field-error").forEach(function (el) {
    el.textContent = "";
    el.classList.remove("show");
  });
}
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* АВТОРИЗАЦИЯ / РЕГИСТРАЦИЯ — таблица users в Supabase */
function updateAuthUI() {
  const userRaw = localStorage.getItem("monolit_user");
  const loginBtns = document.querySelectorAll(".btn-login");
  if (userRaw) {
    const user = JSON.parse(userRaw);
    
    let display = (user.name ? user.name.trim().split(/\s+/)[0] : user.email.split("@")[0]);
    if (display.length > 14) display = display.slice(0, 13) + "…";
    loginBtns.forEach(function (btn) {
      btn.textContent = display;
      btn.title = "Аккаунт: " + (user.name || user.email);
    });
  } else {
    loginBtns.forEach(function (btn) {
      btn.textContent = "Войти";
      btn.title = "";
    });
  }
}

/* КОРЗИНА, для простоты в localStorage */
function getCart() {
  try { return JSON.parse(localStorage.getItem("monolit_cart") || "[]"); }
  catch (e) { return []; }
}
function saveCart(items) {
  localStorage.setItem("monolit_cart", JSON.stringify(items));
  const totalQty = items.reduce(function (sum, i) { return sum + i.qty; }, 0);
  document.querySelectorAll(".cart-count").forEach(function (el) { el.textContent = totalQty; });
}
function addToCart(product, qty) {
  qty = qty || 1;
  const items = getCart();
  const existing = items.find(function (i) { return i.id === product.id; });
  if (existing) { existing.qty += qty; }
  else { items.push(Object.assign({}, product, { qty: qty })); }
  saveCart(items);
}
function clearCart() { saveCart([]); }

/* ИСТОРИЯ ЗАКАЗОВ — таблица orders в Supabase, отфильтрована по user_id */
async function renderOrderHistory(userId) {
  const container = document.getElementById("order-history");
  if (!container) return;
  container.innerHTML = '<p class="order-empty">Загружаем...</p>';

  if (!db) {
    container.innerHTML = '<p class="order-empty">База данных не подключена.</p>';
    return;
  }

  const { data: orders, error } = await db.from("orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = '<p class="order-empty">Не удалось загрузить заказы.</p>';
    return;
  }
  if (!orders || !orders.length) {
    container.innerHTML = '<p class="order-empty">Заказов пока нет — оформите первый через корзину.</p>';
    return;
  }

  container.innerHTML = "";
  orders.forEach(function (order) {
    const dateStr = new Date(order.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    const itemsStr = (order.items || []).map(function (i) { return i.name + " × " + i.qty; }).join(", ");
    const fulfillmentLabel = order.fulfillment === "delivery" ? "Доставка" : "Самовывоз";

    const card = document.createElement("div");
    card.className = "order-card";
    card.innerHTML =
      '<div class="order-head"><span>№ ' + String(order.id).slice(0, 8).toUpperCase() + '</span><span>' + dateStr + '</span></div>' +
      '<div class="order-items">' + itemsStr + '</div>' +
      '<div class="order-meta"><span class="order-tag">' + fulfillmentLabel + '</span></div>' +
      '<div class="order-total"><span>Итого</span><span class="mono">' + Number(order.total).toLocaleString("ru-RU") + ' ₽</span></div>';
    container.appendChild(card);
  });
}

function renderCart() {
  const items = getCart();
  const container = document.getElementById("cart-items");
  const emptyMsg = document.getElementById("cart-empty");
  const summary = document.getElementById("cart-summary");
  const toCheckoutBtn = document.getElementById("to-checkout-btn");
  if (!container) return;

  container.innerHTML = "";

  if (!items.length) {
    emptyMsg.classList.add("show");
    summary.hidden = true;
    if (toCheckoutBtn) toCheckoutBtn.hidden = true;
    document.getElementById("cart-total").textContent = "0 ₽";
    return;
  }
  emptyMsg.classList.remove("show");
  summary.hidden = false;
  if (toCheckoutBtn) toCheckoutBtn.hidden = false;

  let total = 0;
  items.forEach(function (item) {
    total += item.price * item.qty;
    const row = document.createElement("div");
    row.className = "cart-item";
    row.dataset.id = item.id;
    row.innerHTML =
      '<div class="cart-item-info">' +
        '<div class="cart-item-name">' + item.name + '</div>' +
        '<div class="cart-item-price mono">' + item.price + ' ₽ / ' + item.unit + '</div>' +
      '</div>' +
      '<div class="cart-item-qty">' +
        '<button type="button" class="qty-minus" aria-label="Уменьшить">−</button>' +
        '<input type="text" class="qty-val" inputmode="numeric" value="' + item.qty + '" aria-label="Количество">' +
        '<button type="button" class="qty-plus" aria-label="Увеличить">+</button>' +
      '</div>' +
      '<button type="button" class="cart-item-remove" aria-label="Удалить">×</button>';
    container.appendChild(row);
  });

  document.getElementById("cart-total").textContent = total.toLocaleString("ru-RU") + " ₽";

  container.querySelectorAll(".qty-plus").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.closest(".cart-item").dataset.id;
      const items = getCart();
      const item = items.find(function (i) { return i.id === id; });
      if (item) { item.qty += 1; saveCart(items); renderCart(); }
    });
  });
  container.querySelectorAll(".qty-minus").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.closest(".cart-item").dataset.id;
      let items = getCart();
      const item = items.find(function (i) { return i.id === id; });
      if (item) {
        item.qty -= 1;
        if (item.qty <= 0) items = items.filter(function (i) { return i.id !== id; });
        saveCart(items);
        renderCart();
      }
    });
  });
  container.querySelectorAll(".qty-val").forEach(function (input) {
  input.addEventListener("change", function () {
    const id = input.closest(".cart-item").dataset.id;
    let items = getCart();
    const item = items.find(function (i) { return i.id === id; });
    if (!item) return;
    const parsed = parseInt(input.value, 10);
    if (!parsed || parsed < 1) {
      items = items.filter(function (i) { return i.id !== id; });
    } else {
      item.qty = Math.min(parsed, 999);
    }
    saveCart(items);
    renderCart();
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
  });
});
  container.querySelectorAll(".cart-item-remove").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.closest(".cart-item").dataset.id;
      const items = getCart().filter(function (i) { return i.id !== id; });
      saveCart(items);
      renderCart();
    });
  });
}

/* РАЗМЕТКА МОДАЛЬНЫХ ОКОН — создаётся один раз через JS и
   добавляется в конец <body>*/
function injectModals() {
  if (document.getElementById("modal-overlay")) return; // уже вставлено

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal-overlay" id="modal-overlay"></div>

    <div class="modal" id="auth-modal">
      <button class="modal-close" data-close-modal aria-label="Закрыть">×</button>
      <div class="modal-tabs">
        <button type="button" class="modal-tab active" data-auth-tab="login">Вход</button>
        <button type="button" class="modal-tab" data-auth-tab="register">Регистрация</button>
      </div>

      <form id="login-form" class="modal-form" data-auth-panel="login">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" autocomplete="email">
        <span class="field-error" id="login-email-error"></span>
        <label for="login-password">Пароль</label>
        <input type="password" id="login-password" autocomplete="current-password">
        <span class="field-error" id="login-password-error"></span>
        <button type="submit" class="btn-primary" style="width:100%; margin-top:16px;">Войти</button>
      </form>

      <form id="register-form" class="modal-form" data-auth-panel="register" hidden>
        <label for="reg-name">Имя</label>
        <input type="text" id="reg-name" autocomplete="name">
        <span class="field-error" id="reg-name-error"></span>
        <label for="reg-email">Email</label>
        <input type="email" id="reg-email" autocomplete="email">
        <span class="field-error" id="reg-email-error"></span>
        <label for="reg-password">Пароль</label>
        <input type="password" id="reg-password" autocomplete="new-password">
        <span class="field-error" id="reg-password-error"></span>
        <label for="reg-password2">Повторите пароль</label>
        <input type="password" id="reg-password2" autocomplete="new-password">
        <span class="field-error" id="reg-password2-error"></span>
        <button type="submit" class="btn-primary" style="width:100%; margin-top:16px;">Зарегистрироваться</button>
      </form>
    </div>

    <div class="modal modal-wide" id="cart-modal">
      <button class="modal-close" data-close-modal aria-label="Закрыть">×</button>
      <h2 class="modal-title">Корзина</h2>

      <div id="cart-panel-items">
        <p class="cart-empty" id="cart-empty">Корзина пока пуста</p>
        <div id="cart-items"></div>
        <div class="cart-summary-row" id="cart-summary" hidden>
          <span>Итого</span><span class="mono" id="cart-total">0 ₽</span>
        </div>
        <button type="button" class="btn-primary" id="to-checkout-btn" style="width:100%; margin-top:16px;" hidden>Оформить заказ</button>
      </div>

      <form id="checkout-form" class="modal-form" hidden>
        <label>Способ получения</label>
        <div class="fulfillment-toggle" id="fulfillment-toggle">
          <button type="button" class="fulfillment-btn active" data-fulfillment="pickup">Самовывоз</button>
          <button type="button" class="fulfillment-btn" data-fulfillment="delivery">Доставка</button>
        </div>

        <div class="pickup-info" id="pickup-info">
          Забрать можно по адресу <strong>Индустриальный пр., 14</strong>, ежедневно 8:00–20:00.
        </div>

        <div id="delivery-fields" hidden>
          <label for="checkout-address">Адрес доставки</label>
          <input type="text" id="checkout-address" autocomplete="street-address">
          <span class="field-error" id="checkout-address-error"></span>

          <label>Транспорт</label>
          <div class="vehicle-grid vehicle-grid-sm" id="checkout-vehicle-grid">
            <button type="button" class="vehicle-btn active" data-tier="t07"><span class="vt-capacity">0.7 т</span><span class="vt-label">Грузовик</span></button>
            <button type="button" class="vehicle-btn" data-tier="t35"><span class="vt-capacity">3.5 т</span><span class="vt-label">Грузовик</span></button>
            <button type="button" class="vehicle-btn" data-tier="t6"><span class="vt-capacity">6 т</span><span class="vt-label">Грузовик</span></button>
            <button type="button" class="vehicle-btn" data-tier="t10"><span class="vt-capacity">10 т</span><span class="vt-label">Грузовик</span></button>
            <button type="button" class="vehicle-btn" data-tier="m5"><span class="vt-capacity">5 т</span><span class="vt-label">Манипулятор</span></button>
            <button type="button" class="vehicle-btn" data-tier="m10"><span class="vt-capacity">10 т</span><span class="vt-label">Манипулятор</span></button>
          </div>

          <button type="button" class="btn-outline" id="calc-delivery-btn" style="width:100%; margin-bottom:6px;">Рассчитать доставку</button>
          <div class="delivery-error" id="checkout-delivery-error"></div>
          <div class="cart-summary-row" id="checkout-delivery-row" hidden>
            <span>Доставка (<span id="checkout-delivery-km">0</span> км)</span><span class="mono" id="checkout-delivery-cost">0 ₽</span>
          </div>
        </div>

        <label for="checkout-name" style="margin-top:6px;">Имя</label>
        <input type="text" id="checkout-name" autocomplete="name">
        <span class="field-error" id="checkout-name-error"></span>
        <label for="checkout-phone">Телефон</label>
        <input type="text" id="checkout-phone" placeholder="+7 900 000-00-00" autocomplete="tel">
        <span class="field-error" id="checkout-phone-error"></span>

        <div class="cart-summary-row"><span>Товары</span><span class="mono" id="checkout-subtotal">0 ₽</span></div>
        <div class="cart-summary-row"><span>К оплате</span><span class="mono" id="checkout-total">0 ₽</span></div>
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button type="button" class="btn-outline" id="back-to-cart-btn" style="flex:1;">Назад</button>
          <button type="submit" class="btn-primary" style="flex:1;">Подтвердить заказ</button>
        </div>
      </form>

      <div id="cart-panel-success" hidden>
        <p style="font-size:14px; line-height:1.6; margin-bottom:20px;">Заказ оформлен! Мы свяжемся с вами по указанному телефону для подтверждения.</p>
        <button type="button" class="btn-primary" id="close-success-btn" style="width:100%;">Закрыть</button>
      </div>
    </div>

    <div class="modal" id="account-modal">
      <button class="modal-close" data-close-modal aria-label="Закрыть">×</button>
      <h2 class="modal-title">Аккаунт</h2>
      <div class="account-row"><span class="k">Имя</span><span class="v" id="account-name">—</span></div>
      <div class="account-row"><span class="k">Email</span><span class="v" id="account-email">—</span></div>

      <div class="account-subtitle">История заказов</div>
      <div class="order-list" id="order-history"><p class="order-empty">Загружаем...</p></div>

      <button type="button" class="btn-outline" id="logout-btn" style="width:100%; margin-top:22px;">Выйти из аккаунта</button>
    </div>
  `;
  while (wrapper.firstChild) {
    document.body.appendChild(wrapper.firstChild);
  }
}

/* ОБВЯЗКА СОБЫТИЙ, ОБЩАЯ ДЛЯ ВСЕХ СТРАНИЦ */
document.addEventListener("DOMContentLoaded", function () {
  injectModals();
  saveCart(getCart()); // подставить сохранённое количество товаров при загрузке страницы
  updateAuthUI();

  const overlay = document.getElementById("modal-overlay");
  const authModal = document.getElementById("auth-modal");
  const cartModal = document.getElementById("cart-modal");
  const accountModal = document.getElementById("account-modal");

  document.querySelectorAll(".btn-login").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const userRaw = localStorage.getItem("monolit_user");
      if (userRaw) {
        const user = JSON.parse(userRaw);
        document.getElementById("account-name").textContent = user.name || "— (указано только при регистрации)";
        document.getElementById("account-email").textContent = user.email;
        openModal(accountModal);
        renderOrderHistory(user.id);
      } else {
        openModal(authModal);
      }
    });
  });
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      localStorage.removeItem("monolit_user");
      updateAuthUI();
      closeModal(accountModal);
    });
  }
  document.querySelectorAll(".cart-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const checkoutFormEl = document.getElementById("checkout-form");
      const cartPanelItemsEl = document.getElementById("cart-panel-items");
      const cartPanelSuccessEl = document.getElementById("cart-panel-success");
      if (checkoutFormEl) checkoutFormEl.hidden = true;
      if (cartPanelSuccessEl) cartPanelSuccessEl.hidden = true;
      if (cartPanelItemsEl) cartPanelItemsEl.hidden = false;
      renderCart();
      openModal(cartModal);
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".modal.open").forEach(closeModal);
    });
  });
  if (overlay) {
    overlay.addEventListener("click", function () {
      document.querySelectorAll(".modal.open").forEach(closeModal);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach(closeModal);
  });

  // Переключение вкладок Вход / Регистрация Демо
  document.querySelectorAll("[data-auth-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll("[data-auth-tab]").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      const target = tab.dataset.authTab;
      document.querySelectorAll("[data-auth-panel]").forEach(function (panel) {
        panel.hidden = panel.dataset.authPanel !== target;
      });
    });
  });

  // Форма входа
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearFieldErrors(loginForm);
      const email = document.getElementById("login-email").value.trim().toLowerCase();
      const password = document.getElementById("login-password").value;
      let valid = true;

      if (!isValidEmail(email)) { showFieldError("login-email-error", "Введите корректный email"); valid = false; }
      if (password.length < 6) { showFieldError("login-password-error", "Минимум 6 символов"); valid = false; }
      if (!valid) return;

      if (!db) {
        showFieldError("login-email-error", "База данных не подключена");
        return;
      }

      const submitBtn = loginForm.querySelector("button[type=submit]");
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Входим...";
      submitBtn.disabled = true;

      const { data: user, error } = await db.from("users").select("*").eq("email", email).maybeSingle();

      if (error || !user) {
        showFieldError("login-password-error", "Неверный email или пароль");
        submitBtn.textContent = originalLabel;
        submitBtn.disabled = false;
        return;
      }

      const [salt, storedHash] = user.password_hash.split("$");
      const enteredHash = await hashPassword(password, salt);

      submitBtn.textContent = originalLabel;
      submitBtn.disabled = false;

      if (enteredHash !== storedHash) {
        showFieldError("login-password-error", "Неверный email или пароль");
        return;
      }

      localStorage.setItem("monolit_user", JSON.stringify({ id: user.id, name: user.name, email: user.email }));
      updateAuthUI();
      closeModal(authModal);
      loginForm.reset();
    });
  }

  // Форма регистрации
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearFieldErrors(registerForm);
      const name = document.getElementById("reg-name").value.trim();
      const email = document.getElementById("reg-email").value.trim().toLowerCase();
      const password = document.getElementById("reg-password").value;
      const password2 = document.getElementById("reg-password2").value;
      let valid = true;

      if (name.length < 2) { showFieldError("reg-name-error", "Введите имя"); valid = false; }
      if (!isValidEmail(email)) { showFieldError("reg-email-error", "Введите корректный email"); valid = false; }
      if (password.length < 6) { showFieldError("reg-password-error", "Минимум 6 символов"); valid = false; }
      if (password2 !== password) { showFieldError("reg-password2-error", "Пароли не совпадают"); valid = false; }
      if (!valid) return;

      if (!db) {
        showFieldError("reg-email-error", "База данных не подключена");
        return;
      }

      const submitBtn = registerForm.querySelector("button[type=submit]");
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Регистрируем...";
      submitBtn.disabled = true;

      const salt = generateSalt();
      const hash = await hashPassword(password, salt);

      const { data: newUser, error } = await db.from("users")
        .insert({ name: name, email: email, password_hash: salt + "$" + hash })
        .select()
        .single();

      submitBtn.textContent = originalLabel;
      submitBtn.disabled = false;

      if (error) {
        if (error.code === "23505") {
          showFieldError("reg-email-error", "Этот email уже зарегистрирован");
        } else {
          showFieldError("reg-email-error", "Ошибка регистрации: " + error.message);
        }
        return;
      }

      localStorage.setItem("monolit_user", JSON.stringify({ id: newUser.id, name: newUser.name, email: newUser.email }));
      updateAuthUI();
      closeModal(authModal);
      registerForm.reset();
    });
  }

  // Клик по всей карточке товара ведёт на страницу товара (кроме клика по "В корзину")
  document.querySelectorAll(".prod-card[data-href]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      if (e.target.closest(".btn-add") || e.target.closest("a")) return;
      window.location.href = card.dataset.href;
    });
  });

  // 4. Кнопки +/- на странице товара 
  document.querySelectorAll(".qty-control").forEach(function (control) {
    const input = control.querySelector("input");
    if (!input) return;
    const minusBtn = control.querySelector("button:first-child");
    const plusBtn = control.querySelector("button:last-child");
    function clamp() {
      const val = parseInt(input.value, 10);
      input.value = (!val || val < 1) ? 1 : Math.min(val, 999);
    }
    if (minusBtn) minusBtn.addEventListener("click", function () { input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1); });
    if (plusBtn) plusBtn.addEventListener("click", function () { input.value = Math.min(999, (parseInt(input.value, 10) || 1) + 1); });
    input.addEventListener("change", clamp);
  });

  // Добавление товаров в корзину valid
  document.querySelectorAll(".btn-add, .btn-add-lg").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.dataset.id;
      if (!id) return; 
      let qty = 1;
    const qtyInput = btn.closest(".product-info, .qty-row") ? document.querySelector(".qty-control input") : null;
    if (qtyInput) qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    addToCart({ id: id, name: btn.dataset.name, price: parseFloat(btn.dataset.price), unit: btn.dataset.unit || "шт" }, qty);
      document.querySelectorAll(".cart-btn").forEach(function (cartBtn) {
        cartBtn.classList.remove("bump");
        void cartBtn.offsetWidth; // форсируем перерасчёт стилей, чтобы анимация перезапустилась при повторном клике
        cartBtn.classList.add("bump");
      });
    });
  });

  // Переход корзина -> оформление заказа -> успех
  const toCheckoutBtn = document.getElementById("to-checkout-btn");
  const checkoutForm = document.getElementById("checkout-form");
  const cartPanelItems = document.getElementById("cart-panel-items");
  const cartPanelSuccess = document.getElementById("cart-panel-success");
  const backToCartBtn = document.getElementById("back-to-cart-btn");
  const closeSuccessBtn = document.getElementById("close-success-btn");

  // Способ получения: самовывоз / доставка
  let fulfillmentMode = "pickup";
  let checkoutDeliveryCost = 0;
  let checkoutSelectedTier = VEHICLE_TIERS[0].id;

  function getCartSubtotal() {
    return getCart().reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
  }
  function updateCheckoutTotal() {
    const subtotal = getCartSubtotal();
    document.getElementById("checkout-subtotal").textContent = subtotal.toLocaleString("ru-RU") + " ₽";
    document.getElementById("checkout-total").textContent = (subtotal + checkoutDeliveryCost).toLocaleString("ru-RU") + " ₽";
  }

  document.querySelectorAll(".fulfillment-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".fulfillment-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      fulfillmentMode = btn.dataset.fulfillment;
      document.getElementById("pickup-info").hidden = fulfillmentMode !== "pickup";
      document.getElementById("delivery-fields").hidden = fulfillmentMode !== "delivery";
      // Смена способа получения сбрасывает уже посчитанную стоимость доставки —
      // иначе можно переключиться на самовывоз, а старая цена доставки останется в итоге.
      checkoutDeliveryCost = 0;
      document.getElementById("checkout-delivery-row").hidden = true;
      document.getElementById("checkout-delivery-error").classList.remove("show");
      updateCheckoutTotal();
    });
  });

  document.querySelectorAll("#checkout-vehicle-grid .vehicle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#checkout-vehicle-grid .vehicle-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      checkoutSelectedTier = btn.dataset.tier;
      // Смена транспорта сбрасывает расчёт 
      checkoutDeliveryCost = 0;
      document.getElementById("checkout-delivery-row").hidden = true;
      updateCheckoutTotal();
    });
  });

  const calcDeliveryBtn = document.getElementById("calc-delivery-btn");
  if (calcDeliveryBtn) {
    calcDeliveryBtn.addEventListener("click", function () {
      const addressInput = document.getElementById("checkout-address");
      const errorBox = document.getElementById("checkout-delivery-error");
      const rowBox = document.getElementById("checkout-delivery-row");

      errorBox.classList.remove("show");
      rowBox.hidden = true;
      checkoutDeliveryCost = 0;
      updateCheckoutTotal();

      const address = addressInput.value.trim();
      if (!address) {
        errorBox.textContent = "Введите адрес доставки";
        errorBox.classList.add("show");
        return;
      }
      if (typeof ymaps === "undefined" || !deliveryZonePolygon) {
        errorBox.textContent = "Карты ещё не загрузились — подождите секунду и попробуйте снова";
        errorBox.classList.add("show");
        return;
      }

      const originalLabel = calcDeliveryBtn.textContent;
      calcDeliveryBtn.textContent = "Считаем...";
      calcDeliveryBtn.disabled = true;

      const query = address.toLowerCase().includes("санкт-петербург") ? address : address + ", Санкт-Петербург";

      ymaps.geocode(query, { results: 1 }).then(function (res) {
        const found = res.geoObjects.get(0);
        if (!found) throw new Error("Адрес не найден — уточните улицу и номер дома");

        const coords = found.geometry.getCoordinates();
        if (!deliveryZonePolygon.geometry.contains(coords)) {
          throw new Error("Адрес за пределами зоны доставки");
        }

        const distanceKm = haversineDistanceKm(WAREHOUSE.lat, WAREHOUSE.lon, coords[0], coords[1]);
        checkoutDeliveryCost = calculateDeliveryCost(distanceKm, checkoutSelectedTier);
        document.getElementById("checkout-delivery-km").textContent = distanceKm.toFixed(1);
        document.getElementById("checkout-delivery-cost").textContent = checkoutDeliveryCost.toLocaleString("ru-RU") + " ₽";
        rowBox.hidden = false;
        updateCheckoutTotal();

        calcDeliveryBtn.textContent = originalLabel;
        calcDeliveryBtn.disabled = false;

      }).catch(function (err) {
        errorBox.textContent = err.message || "Не удалось рассчитать доставку";
        errorBox.classList.add("show");
        calcDeliveryBtn.textContent = originalLabel;
        calcDeliveryBtn.disabled = false;
      });
    });
  }

  if (toCheckoutBtn) {
    toCheckoutBtn.addEventListener("click", function () {
      updateCheckoutTotal();
      cartPanelItems.hidden = true;
      checkoutForm.hidden = false;
    });
  }
  if (backToCartBtn) {
    backToCartBtn.addEventListener("click", function () {
      checkoutForm.hidden = true;
      cartPanelItems.hidden = false;
    });
  }
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearFieldErrors(checkoutForm);
      const name = document.getElementById("checkout-name").value.trim();
      const phone = document.getElementById("checkout-phone").value.trim();
      let valid = true;

      if (getCartSubtotal() <= 0) {
        cartPanelSuccess.hidden = true;
        checkoutForm.hidden = true;
        cartPanelItems.hidden = false;
        renderCart();
        return;
      }

      if (name.length < 2) { showFieldError("checkout-name-error", "Введите имя"); valid = false; }
      if (!/^[\d+()\s-]{10,}$/.test(phone)) { showFieldError("checkout-phone-error", "Введите корректный телефон"); valid = false; }

      let address = null;
      if (fulfillmentMode === "delivery") {
        address = document.getElementById("checkout-address").value.trim();
        if (address.length < 5) { showFieldError("checkout-address-error", "Введите адрес доставки"); valid = false; }
        else if (checkoutDeliveryCost === 0) {
          const errorBox = document.getElementById("checkout-delivery-error");
          errorBox.textContent = "Сначала нажмите «Рассчитать доставку»";
          errorBox.classList.add("show");
          valid = false;
        }
      }
      if (!valid) return;

      const submitBtn = checkoutForm.querySelector("button[type=submit]");
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Оформляем...";
      submitBtn.disabled = true;

      const userRaw = localStorage.getItem("monolit_user");
      const user = userRaw ? JSON.parse(userRaw) : null;
      const subtotal = getCartSubtotal();

      if (db) {
        const { error } = await db.from("orders").insert({
          user_id: user ? user.id : null,
          customer_name: name,
          phone: phone,
          fulfillment: fulfillmentMode,
          address: address,
          items: getCart(),
          subtotal: subtotal,
          delivery_cost: checkoutDeliveryCost,
          total: subtotal + checkoutDeliveryCost
        });
        // Заказ всё равно оформляем даже при сбое записи в БД — не хотим блокировать
        // покупателя из-за временной недоступности сервиса, просто предупреждаем в консоли.
        if (error) console.warn("Не удалось сохранить заказ в БД:", error);
      } else {
        console.warn("Supabase не настроен — заказ не сохранён в БД.");
      }

      submitBtn.textContent = originalLabel;
      submitBtn.disabled = false;

      clearCart();
      renderCart();
      checkoutForm.hidden = true;
      cartPanelSuccess.hidden = false;
      checkoutForm.reset();

      // Возврат формы к начальному состоянию для следующего заказа
      fulfillmentMode = "pickup";
      checkoutDeliveryCost = 0;
      document.querySelectorAll(".fulfillment-btn").forEach(function (b, i) { b.classList.toggle("active", i === 0); });
      document.getElementById("pickup-info").hidden = false;
      document.getElementById("delivery-fields").hidden = true;
      document.getElementById("checkout-delivery-row").hidden = true;
    });
  }
  if (closeSuccessBtn) {
    closeSuccessBtn.addEventListener("click", function () {
      cartPanelSuccess.hidden = true;
      cartPanelItems.hidden = false;
      closeModal(cartModal);
    });
  }
});
