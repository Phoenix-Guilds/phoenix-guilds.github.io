// =====================================================
// Google Apps Script для обработки заявок на вакансии
// Phoenix Guild - Система управления вакансиями
// =====================================================

// ↓ УСТАНОВИТЬ ЭТИ ЗНАЧЕНИЯ ↓
const SHEET_ID = "17VXVPCC3wpbbVwGBQGDMMzAv-CgGsvDhZ26t6bKvmcA"; // ID таблицы Google Sheets
const DEPLOYMENT_ID = "AKfycbxIUwa9GWQI7O42A9ObVNTAO0MKD8LMM1ssbp18vv75NyBLDQz2cj7lgoozg3TYUzLO"; // Идентификатор развертывания Web App
const SCRIPT_URL = `https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec`;
const ADMIN_EMAIL = "buinoff@gmail.com"; // Email для отправки уведомлений (опционально)

// ↑ УСТАНОВИТЬ ЭТИ ЗНАЧЕНИЯ ↑

const SHEET_NAME = "Заявки";
const ALLOWED_ORIGINS = [
  "https://phoenix-guilds.github.io",
  "http://localhost",
  "http://localhost:4000",
  "http://127.0.0.1",
  "http://phoenix-guilds.githab.test"
];

// =====================================================
// 0. Обработка preflight CORS запроса
// =====================================================

function doOptions(e) {
  return HtmlService.createHtmlOutput("").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =====================================================
// 1. Обработка POST запроса (отправка заявки)
// =====================================================

function doPost(e) {
  try {
    // Получить origin из параметров или из тела запроса
    const requestPayload = e.postData ? JSON.parse(e.postData.contents) : {};
    const origin = e.parameter.origin || requestPayload.origin || "";
    
    // Проверить, разрешён ли этот origin
    if (!isOriginAllowed(origin)) {
      Logger.log(`Запрос с неразрешённого origin: ${origin}`);
      return createErrorResponse("Unauthorized origin", 403);
    }

    // Получить и парсить тело запроса
    const payload = requestPayload;

    // Валидация базовых полей
    if (!payload.name || !payload.character_nicks) {
      return createErrorResponse("Missing required fields: name, character_nicks", 400);
    }

    // Проверить, что указан хотя бы один контакт
    if (!payload.telegram && !payload.discord && !payload.email) {
      return createErrorResponse("At least one contact required (telegram, discord, or email)", 400);
    }

    // Получить лист и добавить новую строку
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    
    const newRow = [
      new Date().toISOString(),           // A: timestamp
      payload.vacancy_id || "",           // B: vacancy_id
      payload.vacancy_title || "",        // C: vacancy_title
      payload.name || "",                 // D: name
      payload.character_nicks || "",      // E: character_nicks
      payload.telegram || "",             // F: telegram
      payload.discord || "",              // G: discord
      payload.email || "",                // H: email
      JSON.stringify(payload.availability || []), // I: availability_json
      payload.additional_info || "",      // J: additional_info
      "новая",                            // K: status (новая/рассмотрена/активна/отклонена/архив)
      "",                                 // L: reviewed_by
      ""                                  // M: notes
    ];

    sheet.appendRow(newRow);

    // Отправить уведомление администратору (опционально)
    if (ADMIN_EMAIL) {
      sendAdminNotification(payload, newRow);
    }

    // Логировать успешное добавление
    Logger.log(`Новая заявка: ${payload.name} на вакансию ${payload.vacancy_title}`);

    return createSuccessResponse("Application received successfully", {
      row: sheet.getLastRow(),
      timestamp: newRow[0]
    });

  } catch (error) {
    Logger.log(`Ошибка при обработке POST: ${error}`);
    return createErrorResponse(error.toString(), 500);
  }
}

// =====================================================
// 2. Обработка GET запроса (получение занятых слотов)
// =====================================================

function doGet(e) {
  try {
    const vacancyId = e.parameter.vacancy_id;

    if (!vacancyId) {
      return createErrorResponse("Missing parameter: vacancy_id", 400);
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();

    const occupiedSlots = [];

    // Фильтруем строки: vacancy_id совпадает И статус = "активна"
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowVacancyId = row[1];     // B: vacancy_id
      const rowStatus = row[10];       // K: status
      const availabilityJson = row[8]; // I: availability_json

      if (rowVacancyId === vacancyId && rowStatus === "активна") {
        try {
          const availability = JSON.parse(availabilityJson);
          if (Array.isArray(availability)) {
            occupiedSlots.push(...availability);
          }
        } catch (parseError) {
          Logger.log(`Ошибка парса JSON в строке ${i}: ${parseError}`);
        }
      }
    }

    Logger.log(`Запрос графика для ${vacancyId}: найдено ${occupiedSlots.length} занятых слотов`);

    return createSuccessResponse("Occupied slots retrieved", {
      vacancy_id: vacancyId,
      occupied_slots: occupiedSlots,
      total_occupied: occupiedSlots.length
    });

  } catch (error) {
    Logger.log(`Ошибка при обработке GET: ${error}`);
    return createErrorResponse(error.toString(), 500);
  }
}

// =====================================================
// 3. Вспомогательные функции
// =====================================================

function isOriginAllowed(origin) {
  if (!origin) return true; // Разрешить пустой origin для локального тестирования
  
  const allowedOrigins = ALLOWED_ORIGINS;
  
  // Проверить точное совпадение
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Проверить по префиксу для localhost
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
    return true;
  }
  
  // Проверить github.io
  if (origin.includes('github.io')) {
    return true;
  }
  
  return false;
}

function createSuccessResponse(message, data = {}) {
  var jsonOutput = JSON.stringify({
    success: true,
    message: message,
    data: data,
    timestamp: new Date().toISOString()
  });
  
  return HtmlService.createHtmlOutput(jsonOutput)
    .setMimeType(HtmlService.MimeType.JSON)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function createErrorResponse(message, statusCode = 400) {
  var jsonOutput = JSON.stringify({
    success: false,
    error: message,
    status: statusCode,
    timestamp: new Date().toISOString()
  });
  
  return HtmlService.createHtmlOutput(jsonOutput)
    .setMimeType(HtmlService.MimeType.JSON)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =====================================================
// 4. Отправка уведомления администратору
// =====================================================

function sendAdminNotification(payload, rowData) {
  try {
    const subject = `📋 Новая заявка на вакансию: ${payload.vacancy_title}`;
    
    const contactInfo = [];
    if (payload.telegram) contactInfo.push(`Telegram: ${payload.telegram}`);
    if (payload.discord) contactInfo.push(`Discord: ${payload.discord}`);
    if (payload.email) contactInfo.push(`Email: ${payload.email}`);

    const availabilityText = payload.availability?.map(slot =>
      `${slot.day} с ${slot.time_start} на ${slot.duration_hours}ч`
    ).join('\n') || 'Не указано';

    const body = `
📝 Новая заявка на вакансию!

🎯 Вакансия: ${payload.vacancy_title}

👤 Информация о кандидате:
• Имя: ${payload.name}
• Персонажи: ${payload.character_nicks}

📞 Контактная информация:
${contactInfo.join('\n')}

⏰ Доступность:
${availabilityText}

📝 Дополнительная информация:
${payload.additional_info || '(не указана)'}

🔗 Посмотреть в таблице:
https://docs.google.com/spreadsheets/d/${SHEET_ID}

⏱️ Время отправки: ${rowData[0]}
    `;

    GmailApp.sendEmail(ADMIN_EMAIL, subject, body);
    Logger.log(`Уведомление отправлено: ${ADMIN_EMAIL}`);

  } catch (error) {
    Logger.log(`Ошибка при отправке email: ${error}`);
    // Не прерываем основной процесс если email не отправился
  }
}

// =====================================================
// 5. Тестовые функции (для разработки)
// =====================================================

function testDoPost() {
  const testPayload = {
    origin: "http://localhost:4000",
    vacancy_id: "skladskoy-pomoshchnik",
    vacancy_title: "Складской помощник",
    name: "Тестовое Имя",
    character_nicks: "Персонаж-1, Персонаж-2",
    telegram: "@testuser",
    discord: "TestUser#1234",
    email: "test@example.com",
    availability: [
      {
        day: "Понедельник",
        time_start: "18:00",
        duration_hours: "2"
      },
      {
        day: "Четверг",
        time_start: "20:00",
        duration_hours: "1"
      }
    ],
    additional_info: "Это тестовая заявка"
  };

  const mockEvent = {
    postData: {
      contents: JSON.stringify(testPayload)
    },
    parameter: {
      origin: "http://localhost:4000"
    }
  };

  const result = doPost(mockEvent);
  Logger.log(`Результат: ${result.getContent()}`);
}

function testDoGet() {
  const mockEvent = {
    parameter: {
      vacancy_id: "skladskoy-pomoshchnik"
    }
  };

  const result = doGet(mockEvent);
  Logger.log(`Результат: ${result.getContent()}`);
}

// =====================================================
// 6. Функции администратора (опционально)
// =====================================================

function getApplicationStats() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  const stats = {
    total: data.length - 1,
    by_vacancy: {},
    by_status: {},
    by_contact: { telegram: 0, discord: 0, email: 0 }
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const vacancy = row[2];  // C: vacancy_title
    const status = row[10];  // K: status
    const telegram = row[5]; // F: telegram
    const discord = row[6];  // G: discord
    const email = row[7];    // H: email

    // По вакансиям
    stats.by_vacancy[vacancy] = (stats.by_vacancy[vacancy] || 0) + 1;

    // По статусам
    stats.by_status[status] = (stats.by_status[status] || 0) + 1;

    // По контактам
    if (telegram) stats.by_contact.telegram++;
    if (discord) stats.by_contact.discord++;
    if (email) stats.by_contact.email++;
  }

  return stats;
}

function archiveOldApplications(daysOld = 90) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  let archivedCount = 0;

  for (let i = data.length - 1; i >= 1; i--) {
    const timestamp = new Date(data[i][0]);
    if (timestamp < cutoffDate && data[i][10] !== "архив") {
      sheet.getRange(i + 1, 11).setValue("архив");
      archivedCount++;
    }
  }

  Logger.log(`Архивировано ${archivedCount} старых заявок`);
  return archivedCount;
}

// =====================================================
// 7. Инструкции по развёртыванию
// =====================================================

/*
ШАГИ ДЛЯ РАЗВЁРТЫВАНИЯ:

1. Открыть Google Sheet таблицу
2. Нажать "Расширения" → "Apps Script"
3. Скопировать весь код этого файла в редактор
4. Установить значение SHEET_ID (скопировать из URL таблицы)
5. Нажать "Развернуть" → "Новое развёртывание"
6. Выбрать тип: "Веб-приложение"
7. Выполнять от имени: (выбрать свой аккаунт)
8. Имеют доступ: "Все" (или "Все, кто имеет ссылку")
9. Нажать "Развернуть"
10. Скопировать URL развёртывания

РЕЗУЛЬТАТ: URL типа https://script.google.com/macros/s/AKfycbw.../usercontent

ТЕСТИРОВАНИЕ:
1. В редакторе Apps Script нажать F12 (консоль разработчика)
2. Запустить функцию testDoPost() или testDoGet()
3. Проверить результаты в логах и в Google Sheet
*/
