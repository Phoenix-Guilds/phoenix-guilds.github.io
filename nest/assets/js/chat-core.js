// Инициализация
function checkPersistedSession() {
    const sessionRaw = localStorage.getItem(STORAGE_KEY);
    if (!sessionRaw) return;

    try {
        const session = JSON.parse(sessionRaw);
        const now = Date.now();

        if (now - session.timestamp > SESSION_EXPIRY) {
            logout();
            return;
        }

        // Восстанавливаем ВСЕ данные
        myNick = session.nick;
        masterKey = session.key;
        currentUser = session.user; // <-- Вот этого не хватало!

        // Продлеваем сессию, передавая текущего юзера
        saveSession(myNick, masterKey, currentUser);

        enterChatUI();
    } catch (e) {
        console.error("Ошибка восстановления сессии", e);
    }
}

// Сохранение сессии
function saveSession(nick, key, user) {
    const session = {
        nick: nick,
        key: key,
        user: user, // Сохраняем весь объект профиля
        timestamp: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

// Функция входа (обновленная)
async function initChat() {
    const nickInput = document.getElementById("user-nick").value.trim();
    const masterPass = document.getElementById("secret-key").value.trim();

    if (!nickInput || !masterPass) return alert("Введите ник и пароль чата!");

    // 1. Проверяем Мастер-пароль и получаем ключ шифрования (как раньше)
    const { data: settings, error: sError } = await client.from("chat_settings").select("*").single();
    if (sError) return alert("Ошибка связи с БД");

    const masterHash = CryptoJS.SHA256(masterPass).toString();
    if (masterHash !== settings.password_hash) return alert("Неверный пароль чата!");

    try {
        const bytes = CryptoJS.AES.decrypt(settings.encrypted_master_key, masterPass);
        masterKey = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) { return alert("Ошибка дешифровки!"); }

    // 2. Проверяем существование пользователя
    const { data: profile, error: pError } = await client
        .from("profiles")
        .select("*")
        .eq("username", nickInput)
        .single();

    if (!profile) {
        // Регистрация нового ника
        const userPass = prompt(`Ник "${nickInput}" свободен. Придумайте ЛИЧНЫЙ пароль для аккаунта:`);
        if (!userPass) return;

        const userPassHash = CryptoJS.SHA256(userPass).toString();
        const { data: newProfile, error: regError } = await client
            .from("profiles")
            .insert([{
                username: nickInput,
                password_hash: userPassHash,
                avatar_url: `https://api.dicebear.com/9.x/avataaars/svg?seed=${nickInput}`
            }])
            .select()
            .single();

        if (regError) return alert("Ошибка регистрации");
        currentUser = newProfile;
    } else {
        // Вход в существующий аккаунт
        const userPass = prompt(`Ник занят. Введите пароль для "${nickInput}":`);
        const userPassHash = CryptoJS.SHA256(userPass).toString();

        if (userPassHash !== profile.password_hash) {
            return alert("Неверный личный пароль!");
        }
        if (profile.is_banned) return alert("Ваш аккаунт заблокирован!");

        currentUser = profile;
    }

    myNick = currentUser.username;
    saveSession(myNick, masterKey, currentUser); // Добавляем профиль в сессию
    enterChatUI();
}

// Общая логика входа в интерфейс
function enterChatUI() {
    document.getElementById("auth-gate").style.display = "none";
    document.getElementById("msg-field").disabled = false;
    document.getElementById("send-btn").disabled = false;

    renderUserHeader()
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