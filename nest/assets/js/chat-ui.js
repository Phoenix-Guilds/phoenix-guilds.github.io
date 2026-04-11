// Логика звука и настроек
function toggleSettings() {
    const menu = document.getElementById("settings-menu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

function setMute(minutes) {
    let until = 0;
    if (minutes === -1) until = 9999999999999;
    else if (minutes > 0) until = Date.now() + minutes * 60 * 1000;

    localStorage.setItem("chat_mute_until", until);
    updateMuteUI();
    document.getElementById("settings-menu").style.display = "none";
}

function updateMuteUI() {
    const until = parseInt(localStorage.getItem("chat_mute_until") || "0");
    const indicator = document.getElementById("mute-indicator");

    document.querySelectorAll(".mute-option").forEach((el) => el.classList.remove("mute-active"));

    if (until > Date.now()) {
        indicator.innerText = until > Date.now() + 10 * 365 * 24 * 60 * 60 * 1000 ? "🔕 Без звука" : "🔇 Мьют активен";
        indicator.classList.replace("btn-outline-secondary", "btn-outline-warning");
    } else {
        indicator.innerText = "🔊 Настройки";
        indicator.classList.replace("btn-outline-warning", "btn-outline-secondary");
        document.getElementById("mute-0").classList.add("mute-active");
    }
}

function playNotifSound() {
    const until = parseInt(localStorage.getItem("chat_mute_until") || "0");
    if (Date.now() > until) {
        const sound = document.getElementById("notif-sound");
        sound.currentTime = 0;
        sound.play().catch((e) => console.log("Браузер заблокировал звук"));
    }
}

// Рендер сообщений
function displayMessage(msg, method = "prepend") {
    const container = document.getElementById("chat-messages");
    const existing = document.getElementById(`msg-${msg.id}`);
    if (existing) existing.remove();

    let text = "🔒 Error";
    try {
        const bytes = CryptoJS.AES.decrypt(msg.payload, masterKey);
        text = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) { }

    const isOwn = msg.author === myNick;
    const cleanText = text.replace(/'/g, "&apos;").replace(/"/g, "&quot;");

    const msgHtml = `
    <div class="msg-bubble ${isOwn ? "own" : ""}" id="msg-${msg.id}">
      <div class="msg-actions">
        <div class="msg-btn" onclick="prepareReply(${msg.id}, '${msg.author}', '${cleanText}')">↩</div>
        ${isOwn ? `<div class="msg-btn" onclick="prepareEdit(${msg.id}, '${cleanText}')">✏️</div>` : ""}
        ${isOwn ? `<div class="msg-btn" onclick="deleteMessage(${msg.id})">🗑️</div>` : ""}
      </div>
      <div class="msg-info">
        ${msg.author} • ${new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        ${msg.is_edited ? '<span class="edited-mark">(изм.)</span>' : ""}
      </div>
      ${msg.reply_to_id ? `<div class="reply-quote" onclick="scrollToMessage(${msg.reply_to_id})">⤴ Ответ на сообщение</div>` : ""}
      <div class="msg-text">${text}</div>
    </div>`;

    method === "prepend" ? container.insertAdjacentHTML("afterbegin", msgHtml) : container.insertAdjacentHTML("beforeend", msgHtml);
}

// Вспомогательные UI функции
function showPreview(text) {
    document.getElementById("reply-text").innerText = text;
    document.getElementById("reply-preview").style.display = "flex";
    document.getElementById("msg-field").focus();
}

function cancelAllModes() {
    replyId = null;
    editingId = null;
    document.getElementById("msg-field").value = "";
    document.getElementById("reply-preview").style.display = "none";
}

function scrollToMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.background = "#444";
        setTimeout(() => (el.style.background = ""), 1500);
    }
}

let picker = null;

function toggleEmojiPicker() {
    const container = document.getElementById("emoji-picker-container");

    // Инициализируем пикер только при первом клике (ленивая загрузка)
    if (!picker) {
        picker = new EmojiMart.Picker({
            data: async () => {
                const response = await fetch("https://cdn.jsdelivr.net/npm/@emoji-mart/data");
                return response.json();
            },
            onEmojiSelect: (emoji) => {
                const input = document.getElementById("msg-field");
                // Вставляем эмодзи в текущую позицию курсора
                const start = input.selectionStart;
                const end = input.selectionEnd;
                const text = input.value;
                input.value = text.slice(0, start) + emoji.native + text.slice(end);

                // Возвращаем фокус на инпут
                input.focus();
                // Скрываем пикер после выбора (опционально)
                container.style.display = "none";
            },
            theme: "dark", // Темы: light или dark
            locale: "ru",
        });
        container.appendChild(picker);
    }

    container.style.display = container.style.display === "none" ? "block" : "none";
}
function showProfile() {
    const avatar = prompt("Введите ссылку на новую аватарку:", currentUser.avatar_url);
    if (avatar && avatar !== currentUser.avatar_url) {
        updateProfile({ avatar_url: avatar });
    }
}

async function updateProfile(updates) {
    const { data, error } = await client
        .from("profiles")
        .update(updates)
        .eq("id", currentUser.id)
        .select()
        .single();

    if (!error) {
        currentUser = data; // Обновили локальную переменную

        // КРИТИЧЕСКИЙ МОМЕНТ: Обновляем сессию в localStorage
        // Теперь при перезагрузке страницы подхватятся новые данные
        saveSession(myNick, masterKey, currentUser);

        renderUserHeader();
        alert("Профиль обновлен!");
    } else {
        console.error("Ошибка при обновлении профиля:", error);
        alert("Не удалось сохранить изменения.");
    }
}

function renderUserHeader() {
    if (currentUser) {
        const img = document.getElementById("user-avatar");
        img.src = currentUser.avatar_url;
        img.style.display = "block";
        document.getElementById("display-name").innerText = currentUser.username;

        // Если есть роль, можем покрасить ник
        if (currentUser.role === 'owner' || currentUser.role === 'admin') {
            document.getElementById("display-name").classList.add("text-info");
        }
    }
}

async function deleteAccount() {
    if (confirm("ВНИМАНИЕ! Это полностью удалит ваш аккаунт без возможности восстановления. Продолжить?")) {
        await client.from("profiles").delete().eq("id", currentUser.id);
        logout();
    }
}

// Обработка клика вне меню
window.onclick = function (event) {
    if (!event.target.matches("#mute-indicator")) {
        const menu = document.getElementById("settings-menu");
        if (menu && menu.style.display === "block") menu.style.display = "none";
    }

    if (!event.target.closest('#emoji-picker-container') && !event.target.matches('.btn-outline-secondary')) {
        document.getElementById("emoji-picker-container").style.display = "none";
    }
};