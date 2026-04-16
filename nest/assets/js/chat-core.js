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

    if (!nickInput || !masterPass) return chatAlert("Внимание", "Введите ник и пароль чата!");

    const { data: settings, error: sError } = await client.from("chat_settings").select("*").single();
    if (sError) return chatAlert("Ошибка", "Ошибка связи с БД");

    const masterHash = CryptoJS.SHA256(masterPass).toString();
    if (masterHash !== settings.password_hash) return chatAlert("Ошибка", "Неверный пароль чата!");

    try {
        const bytes = CryptoJS.AES.decrypt(settings.encrypted_master_key, masterPass);
        masterKey = bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) { return chatAlert("Ошибка", "Ошибка дешифровки!"); }

    const { data: profile } = await client.from("profiles").select("*").eq("username", nickInput).single();

    if (!profile) {
        const userPass = await chatPrompt("Регистрация", `Ник "${nickInput}" свободен. Придумайте личный пароль:`);
        if (!userPass) return;

        const { data: newProfile, error: regError } = await client.from("profiles").insert([{
            username: nickInput,
            password_hash: CryptoJS.SHA256(userPass).toString(),
            avatar_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${nickInput}`
        }]).select().single();

        if (regError) return chatAlert("Ошибка", "Ошибка регистрации");
        currentUser = newProfile;
    } else {
        const userPass = await chatPrompt("Авторизация", `Введите личный пароль для "${nickInput}":`);
        if (!userPass) return;

        if (CryptoJS.SHA256(userPass).toString() !== profile.password_hash) {
            return chatAlert("Ошибка", "Неверный личный пароль!");
        }
        if (profile.is_banned) return chatAlert("Доступ закрыт", "Ваш аккаунт заблокирован!");

        currentUser = profile;
    }

    myNick = currentUser.username;
    saveSession(myNick, masterKey, currentUser);
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
// Вспомогательная функция для получения размеров изображения
const getImageDimensions = (file) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // Замеряем реальные пиксели файла
            const dims = {
                w: img.naturalWidth || 1200,
                h: img.naturalHeight || 800
            };
            URL.revokeObjectURL(img.src);
            resolve(dims);
        };
        img.onerror = () => resolve({ w: 1200, h: 800 });
        img.src = URL.createObjectURL(file);
    });
};

async function handleSend() {
    const field = document.getElementById("msg-field");
    const text = field.value.trim();

    if ((!text && selectedFiles.length === 0) || !masterKey) return;

    field.disabled = true;

    try {
        let mediaData = [];

        for (const file of selectedFiles) {
            const dims = await getImageDimensions(file);
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(7)}.${fileExt}`;
            const filePath = `public/${fileName}`;

            const { data, error: uploadError } = await client.storage
                .from('chat-media')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: urlData } = client.storage
                .from('chat-media')
                .getPublicUrl(filePath);

            mediaData.push({
                url: urlData.publicUrl,
                w: dims.w,
                h: dims.h
            });
        }

        const msgObject = { text: text, media: mediaData };
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(msgObject), masterKey).toString();

        if (editingId) {
            await client.from("messages").update({ payload: encrypted, is_edited: true }).eq("id", editingId);
            cancelAllModes();
        } else {
            const { error } = await client.from("messages").insert([{
                author: myNick,
                payload: encrypted,
                reply_to_id: replyId
            }]);

            if (!error) {
                field.value = "";
                selectedFiles = [];
                if (document.getElementById("image-previews")) document.getElementById("image-previews").innerHTML = "";
                if (document.getElementById("file-input")) document.getElementById("file-input").value = "";
                cancelAllModes();
            }
        }
    } catch (err) {
        console.error(err);
        chatAlert("Ошибка", "Не удалось отправить");
    } finally {
        field.disabled = false;
        field.focus();
    }
}

// Загрузка данных
async function loadHistory() {
    if (isLoadedAll) return;
    let query = client.from("messages").select(`
        *,
        reactions(*),
        author_name:author,
        author:profiles(avatar_url)
    `).order("created_at", { ascending: false }).limit(40);
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
    // 1. Сообщения
    client.channel("messages_changes").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
        if (p.eventType === "DELETE") {
            const el = document.getElementById(`msg-${p.old.id}`);
            if (el) el.remove();
        } else {
            displayMessage(p.new, "prepend");
            if (p.eventType === "INSERT" && p.new.author !== myNick) playNotifSound();
        }
    }).subscribe();

    // 2. Реакции
    client.channel("reactions_changes").on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, async (p) => {
        let messageId = p.new?.message_id || p.old?.message_id;
        if (!messageId && p.eventType === "DELETE") {
            const allContainers = document.querySelectorAll('.reactions-container');
            allContainers.forEach(async (container) => {
                const mid = container.id.replace('reactions-', '');
                const { data: updated } = await client.from('reactions').select('*').eq('message_id', mid);
                container.outerHTML = renderReactionsHTML(mid, updated || []);
            });
            return;
        }
        if (messageId) {
            const { data: updated } = await client.from('reactions').select('*').eq('message_id', messageId);
            const container = document.getElementById(`reactions-${messageId}`);
            if (container) container.outerHTML = renderReactionsHTML(messageId, updated || []);
        }
    }).subscribe();

    // 3. НОВЫЙ БЛОК: Broadcast для индикатора печати
    broadcastChannel = client.channel('chat-room-1');

    broadcastChannel
        .on('broadcast', { event: 'typing' }, (payload) => {
            const { user } = payload.payload;
            if (user === myNick) return;

            typingUsers.set(user, Date.now());
            updateTypingUI();

            // Удаляем через 3 сек неактивности
            setTimeout(() => {
                if (Date.now() - (typingUsers.get(user) || 0) >= 3000) {
                    typingUsers.delete(user);
                    updateTypingUI();
                }
            }, 3100);
        })
        .subscribe();
}

// Функция отправки сигнала "я печатаю"
function sendTypingSignal() {
    if (!broadcastChannel || !myNick) return;
    broadcastChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user: myNick },
    });
}

// Функция переключения реакции (ИСПРАВЛЕНО - добавлена очистка кэша)
async function toggleReaction(messageId, emoji) {
    if (!currentUser) return;

    const myId = currentUser.id;
    const myName = currentUser.username;
    const myAvatar = currentUser.avatar_url;

    // Сначала проверяем, есть ли уже такая реакция от нас
    const { data: existing } = await client
        .from('reactions')
        .select('id, emoji')
        .eq('message_id', messageId)
        .eq('user_id', myId)
        .maybeSingle();

    if (existing) {
        if (existing.emoji === emoji) {
            // Если нажали на тот же эмодзи — удаляем его
            await client.from('reactions').delete().eq('id', existing.id);
        } else {
            // Если нажали на другой — обновляем
            await client.from('reactions').update({ emoji: emoji }).eq('id', existing.id);
        }
    } else {
        // Если реакции нет — создаем
        await client.from('reactions').insert({
            message_id: messageId,
            user_id: myId,
            user_name: myName,
            user_avatar: myAvatar,
            emoji: emoji
        });
    }

    // UI обновится автоматически через Realtime канал во всех вкладках
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
    if (!confirm("Удалить это сообщение и вложения?")) return;

    const { data: msg } = await client.from("messages").select("payload").eq("id", id).single();

    if (msg) {
        try {
            const bytes = CryptoJS.AES.decrypt(msg.payload, masterKey);
            const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);

            if (decryptedStr.startsWith('{')) {
                const obj = JSON.parse(decryptedStr);

                if (obj.media && obj.media.length > 0) {
                    const pathsToDelete = obj.media.map(item => {
                        const url = (typeof item === 'object') ? item.url : item;

                        // 1. Находим начало пути после имени бакета
                        const bucketName = 'chat-media';
                        const searchStr = `/${bucketName}/`;
                        const index = url.indexOf(searchStr);

                        if (index !== -1) {
                            // Извлекаем всё, что идет ПОСЛЕ '/chat-media/'
                            let path = url.substring(index + searchStr.length);

                            // 2. Декодируем URL (на случай если в имени файла есть пробелы или спецсимволы %20 и т.д.)
                            path = decodeURIComponent(path);

                            return path;
                        }
                        return null;
                    }).filter(p => p !== null);

                    if (pathsToDelete.length > 0) {
                        const { data, error: storageError } = await client.storage
                            .from('chat-media')
                            .remove(pathsToDelete);

                        if (storageError) {
                            console.error("Ошибка Storage:", storageError);
                        } else {
                            if (data && data.length === 0) {
                                console.warn("Внимание: Файлы не найдены в хранилище. Проверь иерархию папок в Supabase.");
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Не удалось обработать вложения (возможно, старый формат):", e);
        }
    }

    // Удаляем само сообщение
    const { error: deleteError } = await client.from("messages").delete().eq("id", id);
    if (deleteError) console.error("Ошибка удаления сообщения:", deleteError);
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

document.getElementById("msg-field").addEventListener("input", () => {
    // Чтобы не спамить в сеть каждым нажатием, шлем сигнал раз в 2 секунды
    if (!typingTimeout) {
        sendTypingSignal();
        typingTimeout = setTimeout(() => {
            typingTimeout = null;
        }, 2000);
    }
});

async function handleFileSelect(event) {
    const files = Array.from(event.target.files);

    // 1. Проверка на общее количество
    if (selectedFiles.length + files.length > 10) {
        event.target.value = ""; // Сбрасываем инпут
        return chatAlert("Ой", "Максимум 10 файлов!");
    }

    const options = {
        maxSizeMB: 2,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        initialQuality: 1
    };

    for (const file of files) {
        // 2. ФИЛЬТР: Пропускаем всё, что не является изображением
        if (!file.type.startsWith('image/')) {
            console.warn(`Файл ${file.name} пропущен: не изображение.`);
            continue; // Просто пропускаем файл и идем к следующему
        }

        try {
            // Оптимизация на лету
            const compressedFile = file.type === 'image/gif'
                ? file
                : await imageCompression(file, options);

            selectedFiles.push(compressedFile);
            renderPreviews();
        } catch (error) {
            console.error("Ошибка сжатия файла:", error);
        }
    }

    // 3. СБРОС ИНПУТА: чтобы можно было выбрать те же файлы снова
    event.target.value = "";
}

function renderPreviews() {
    const container = document.getElementById("image-previews");
    container.innerHTML = selectedFiles.map((f, i) => `
        <div class="position-relative mt-3">
            <img src="${URL.createObjectURL(f)}" style="width:60px;height:60px;object-fit:cover" class="rounded border">
            <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" 
                  style="cursor:pointer" onclick="removeFile(${i})">&times;</span>
        </div>
    `).join("");
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderPreviews();
}

// Изменяем handleSend
async function handleSend() {
    const field = document.getElementById("msg-field");
    const text = field.value.trim();

    // Если нет ни текста, ни выбранных файлов — ничего не делаем
    if (!text && selectedFiles.length === 0) return;

    // Блокируем интерфейс на время загрузки
    field.disabled = true;
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.disabled = true;

    try {
        let mediaUrls = [];

        // 1. Загружаем файлы в Supabase Storage, если они выбраны
        if (selectedFiles.length > 0) {
            for (const file of selectedFiles) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                const filePath = `public/${fileName}`;

                const { data, error: uploadError } = await client.storage
                    .from('chat-media')
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                const { data: urlData } = client.storage
                    .from('chat-media')
                    .getPublicUrl(filePath);

                mediaUrls.push(urlData.publicUrl);
            }
        }

        // 2. Формируем объект сообщения (Новый формат)
        const messageObject = {
            text: text,
            media: mediaUrls
        };

        // 3. Шифруем весь объект как одну строку
        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(messageObject), masterKey).toString();

        // 4. Отправляем в БД
        if (editingId) {
            await client.from("messages").update({ payload: encrypted, is_edited: true }).eq("id", editingId);
            cancelAllModes();
        } else {
            const { error } = await client.from("messages").insert([{
                author: myNick,
                payload: encrypted,
                reply_to_id: replyId
            }]);

            if (!error) {
                field.value = "";
                selectedFiles = []; // Очищаем массив файлов
                const previewContainer = document.getElementById("image-previews");
                if (previewContainer) previewContainer.innerHTML = ""; // Очищаем превью в UI
                cancelAllModes();
            }
        }
    } catch (err) {
        console.error("Ошибка при отправке:", err);
        alert("Не удалось отправить сообщение: " + err.message);
    } finally {
        field.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        field.focus();
    }
}

// Функция переключения реакции
async function toggleReaction(messageId, emoji) {
    if (!currentUser) return;

    const myId = currentUser.id;
    const myName = currentUser.username;
    const myAvatar = currentUser.avatar_url;

    const { data: existing } = await client
        .from('reactions')
        .select('id, emoji')
        .eq('message_id', messageId)
        .eq('user_id', myId)
        .maybeSingle();

    // Выполняем действие в БД
    if (existing) {
        if (existing.emoji === emoji) {
            await client.from('reactions').delete().eq('id', existing.id);
        } else {
            await client.from('reactions').update({ emoji: emoji }).eq('id', existing.id);
        }
    } else {
        await client.from('reactions').insert({
            message_id: messageId,
            user_id: myId,
            user_name: myName,
            user_avatar: myAvatar,
            emoji: emoji
        });
    }

    // СРАЗУ ОБНОВЛЯЕМ UI в текущей вкладке
    // Это делает интерфейс отзывчивым
    const { data: updated } = await client
        .from('reactions')
        .select('*')
        .eq('message_id', messageId);

    const container = document.getElementById(`reactions-${messageId}`);
    if (container) {
        container.outerHTML = renderReactionsHTML(messageId, updated || []);
    }
}
