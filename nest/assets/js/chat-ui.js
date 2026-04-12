// Хелперы для модальных окон (вместо alert/confirm/prompt)
const chatAlert = (title, text) => {
    const modal = new bootstrap.Modal(document.getElementById('chatModal'));
    document.getElementById('chatModalTitle').innerText = title;
    document.getElementById('chatModalBody').innerText = text;
    document.getElementById('modalBtnCancel').style.display = 'none';
    document.getElementById('modalBtnConfirm').onclick = () => modal.hide();
    modal.show();
};

const chatConfirm = (title, text) => {
    return new Promise((resolve) => {
        const modal = new bootstrap.Modal(document.getElementById('chatModal'));
        document.getElementById('chatModalTitle').innerText = title;
        document.getElementById('chatModalBody').innerText = text;
        document.getElementById('modalBtnCancel').style.display = 'inline-block';

        document.getElementById('modalBtnConfirm').onclick = () => { modal.hide(); resolve(true); };
        document.getElementById('modalBtnCancel').onclick = () => { modal.hide(); resolve(false); };
        modal.show();
    });
};

const chatPrompt = (title, text, isPassword = true) => {
    return new Promise((resolve) => {
        const modalEl = document.getElementById('promptModal');
        const modal = new bootstrap.Modal(modalEl);
        const input = document.getElementById('promptModalInput');

        document.getElementById('promptModalTitle').innerText = title;
        document.getElementById('promptModalText').innerText = text;
        input.type = isPassword ? 'password' : 'text';
        input.value = '';

        document.getElementById('promptBtnConfirm').onclick = () => {
            const val = input.value.trim();
            if (val) { modal.hide(); resolve(val); }
        };

        modalEl.addEventListener('shown.bs.modal', () => input.focus(), { once: true });
        modal.show();
    });
};

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

function displayMessage(msg, method = "prepend") {
    const container = document.getElementById("chat-messages");
    const existing = document.getElementById(`msg-${msg.id}`);
    if (existing) existing.remove();

    let decryptedText = "";
    let mediaHtml = "";
    let rawContent = "🔒 Error";

    try {
        const bytes = CryptoJS.AES.decrypt(msg.payload, masterKey);
        rawContent = bytes.toString(CryptoJS.enc.Utf8);

        // Проверка формата: JSON (новое) или Текст (старое)
        if (rawContent.startsWith('{') && rawContent.endsWith('}')) {
            const obj = JSON.parse(rawContent);
            decryptedText = obj.text || "";

            if (obj.media && obj.media.length > 0) {
                mediaHtml = `<div class="msg-media-grid items-${obj.media.length}">`;
                obj.media.forEach(item => {
                    const isObj = typeof item === 'object';
                    const url = isObj ? item.url : item;
                    const width = isObj ? item.w : "1200";
                    const height = isObj ? item.h : "800";

                    mediaHtml += `
            <a href="${url}" 
               data-pswp-width="${width}" 
               data-pswp-height="${height}" 
               target="_blank" 
               class="msg-img-link">
                <img src="${url}" class="msg-img" loading="lazy">
            </a>`;
                });
                mediaHtml += `</div>`;
            }
        } else {
            decryptedText = rawContent;
        }
    } catch (e) {
        decryptedText = rawContent;
    }

    const isOwn = msg.author === myNick;
    const cleanText = decryptedText.replace(/'/g, "&apos;").replace(/"/g, "&quot;");

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
      
      ${mediaHtml}
      <div class="msg-text">${decryptedText}</div>
    </div>`;

    method === "prepend" ? container.insertAdjacentHTML("afterbegin", msgHtml) : container.insertAdjacentHTML("beforeend", msgHtml);
}

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
    if (!picker) {
        picker = new EmojiMart.Picker({
            data: async () => {
                const response = await fetch("https://cdn.jsdelivr.net/npm/@emoji-mart/data");
                return response.json();
            },
            onEmojiSelect: (emoji) => {
                const input = document.getElementById("msg-field");
                const start = input.selectionStart;
                const end = input.selectionEnd;
                input.value = input.value.slice(0, start) + emoji.native + input.value.slice(end);
                input.focus();
                container.style.display = "none";
            },
            theme: "dark",
            locale: "ru",
        });
        container.appendChild(picker);
    }
    container.style.display = container.style.display === "none" ? "block" : "none";
}

// Открытие модалки профиля
function showProfile() {
    const modal = new bootstrap.Modal(document.getElementById('profileModal'));
    const preview = document.getElementById('profile-preview');
    const controls = document.getElementById('avatar-editor-controls');

    // Сбрасываем состояние редактора (скрываем при открытии)
    controls.style.display = "none";

    // Заполняем данные
    tempAvatarUrl = currentUser.avatar_url;
    preview.src = tempAvatarUrl;
    document.getElementById('profile-username-display').innerText = currentUser.username;

    document.getElementById('saveProfileBtn').onclick = async () => {
        if (tempAvatarUrl !== currentUser.avatar_url) {
            await updateProfile({ avatar_url: tempAvatarUrl });
        }
        modal.hide();
    };

    modal.show();
}

// Показать/скрыть выбор стилей
function toggleAvatarEditor() {
    const controls = document.getElementById('avatar-editor-controls');
    const isHidden = controls.style.display === "none" || controls.style.display === "";

    controls.style.display = isHidden ? "block" : "none";

    // Если открыли — сразу генерируем вариант, если до этого аватарка была пустой
    if (isHidden && !tempAvatarUrl) {
        generatePreview();
    }
}

// Генерация превью (обновленная)
function generatePreview(randomize = false) {
    const style = document.getElementById('avatar-style').value;
    const seed = randomize ? Math.random().toString(36).substring(7) : currentUser.username;

    tempAvatarUrl = `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
    document.getElementById('profile-preview').src = tempAvatarUrl;
}

// Обновляем функцию updateProfile (убираем лишний alert, если хочешь)
async function updateProfile(updates) {
    const { data, error } = await client.from("profiles").update(updates).eq("id", currentUser.id).select().single();
    if (!error) {
        currentUser = data;
        saveSession(myNick, masterKey, currentUser);
        renderUserHeader();
        // Можно добавить маленькое уведомление (Toast) вместо Alert
    } else {
        chatAlert("Ошибка", "Не удалось сохранить изменения.");
    }
}

async function updateProfile(updates) {
    const { data, error } = await client.from("profiles").update(updates).eq("id", currentUser.id).select().single();
    if (!error) {
        currentUser = data;
        saveSession(myNick, masterKey, currentUser);
        renderUserHeader();
        chatAlert("Успех", "Профиль обновлен!");
    } else {
        chatAlert("Ошибка", "Не удалось сохранить изменения.");
    }
}

function renderUserHeader() {
    if (currentUser) {
        const img = document.getElementById("user-avatar");
        img.src = currentUser.avatar_url;
        img.style.display = "block";
        document.getElementById("display-name").innerText = currentUser.username;
        if (currentUser.role === 'owner' || currentUser.role === 'admin') {
            document.getElementById("display-name").classList.add("text-info");
        }
    }
}

async function deleteAccount() {
    const confirmed = await chatConfirm("Удаление аккаунта", "Это действие нельзя отменить. Вы уверены?");
    if (confirmed) {
        await client.from("profiles").delete().eq("id", currentUser.id);
        logout();
    }
}

window.onclick = function (event) {
    if (!event.target.matches("#mute-indicator")) {
        const menu = document.getElementById("settings-menu");
        if (menu && menu.style.display === "block") menu.style.display = "none";
    }
    if (!event.target.closest('#emoji-picker-container') && !event.target.matches('.btn-outline-secondary')) {
        document.getElementById("emoji-picker-container").style.display = "none";
    }
};