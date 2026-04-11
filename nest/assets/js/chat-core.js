// Инициализация
function checkPersistedSession() {
    const sessionRaw = localStorage.getItem(STORAGE_KEY);
    if (!sessionRaw) return;

    try {
        const session = JSON.parse(sessionRaw);
        const now = Date.now();

        // Проверяем срок годности
        if (now - session.timestamp > SESSION_EXPIRY) {
            logout();
            return;
        }

        // Восстанавливаем данные
        myNick = session.nick;
        masterKey = session.key;

        // Продлеваем сессию
        saveSession(myNick, masterKey);

        // Входим в чат без пароля
        enterChatUI();
    } catch (e) {
        console.error("Ошибка восстановления сессии", e);
    }
}

// Сохранение сессии
function saveSession(nick, key) {
    const session = {
        nick: nick,
        key: key,
        timestamp: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

// Функция входа (обновленная)
async function initChat() {
    myNick = document.getElementById("user-nick").value.trim();
    const inputPass = document.getElementById("secret-key").value.trim();
    if (!myNick || !inputPass) return alert("Введите данные!");

    const { data: settings, error } = await client.from("chat_settings").select("*").single();
    if (error) return alert("Ошибка БД");

    const loginHash = CryptoJS.SHA256(inputPass).toString();
    if (loginHash !== settings.password_hash) return alert("Неверный пароль!");

    try {
        const bytes = CryptoJS.AES.decrypt(settings.encrypted_master_key, inputPass);
        masterKey = bytes.toString(CryptoJS.enc.Utf8);
        if (!masterKey) throw new Error();
    } catch (e) {
        return alert("Ошибка дешифровки!");
    }

    // Сохраняем сессию на 30 дней
    saveSession(myNick, masterKey);
    enterChatUI();
}

// Общая логика входа в интерфейс
function enterChatUI() {
    document.getElementById("auth-gate").style.display = "none";
    document.getElementById("msg-field").disabled = false;
    document.getElementById("send-btn").disabled = false;

    updateMuteUI();
    loadHistory();
    startRealtime();
    setupInfiniteScroll();
}

// Функция выхода
function logout() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload(); // Перезагрузка вернет auth-gate
}

// Запускаем проверку сразу при загрузке скрипта
checkPersistedSession();

// Отправка и редактирование
async function handleSend() {
    const field = document.getElementById("msg-field");
    const text = field.value.trim();
    if (!text || !masterKey) return;

    const encrypted = CryptoJS.AES.encrypt(text, masterKey).toString();

    if (editingId) {
        await client.from("messages").update({ payload: encrypted, is_edited: true }).eq("id", editingId);
        cancelAllModes();
    } else {
        const { error } = await client.from("messages").insert([{ author: myNick, payload: encrypted, reply_to_id: replyId }]);
        if (!error) {
            field.value = "";
            cancelAllModes();
        }
    }
}

// Загрузка данных
async function loadHistory() {
    if (isLoadedAll) return;
    let query = client.from("messages").select("*").order("created_at", { ascending: false }).limit(40);
    if (lastTimestamp) query = query.lt("created_at", lastTimestamp);

    const { data } = await query;
    if (!data || data.length === 0) {
        isLoadedAll = true;
        return;
    }
    lastTimestamp = data[data.length - 1].created_at;
    data.forEach((msg) => displayMessage(msg, "append"));
}

// Realtime события
function startRealtime() {
    client.channel("any").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
        if (p.eventType === "DELETE") {
            const el = document.getElementById(`msg-${p.old.id}`);
            if (el) el.remove();
        } else {
            displayMessage(p.new, "prepend");
            if (p.eventType === "INSERT" && p.new.author !== myNick) {
                playNotifSound();
            }
        }
    }).subscribe();
}

// Режимы ответа/редактирования
function prepareReply(id, author, text) {
    cancelAllModes();
    replyId = id;
    showPreview(`Ответ ${author}: ${text.substring(0, 20)}...`);
}

function prepareEdit(id, text) {
    cancelAllModes();
    editingId = id;
    document.getElementById("msg-field").value = text;
    showPreview(`Редактирование...`);
}

async function deleteMessage(id) {
    if (confirm("Удалить?")) await client.from("messages").delete().eq("id", id);
}

// Скролл и ввод
function setupInfiniteScroll() {
    const container = document.getElementById("chat-messages");
    container.onscroll = () => {
        if (Math.abs(container.scrollTop) + container.clientHeight >= container.scrollHeight - 20) loadHistory();
    };
}

document.getElementById("msg-field").onkeypress = (e) => {
    if (e.key === "Enter") handleSend();
};