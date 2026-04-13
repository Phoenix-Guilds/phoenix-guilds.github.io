
const SUPABASE_URL = "https://aancnktkdjotjbtdjznw.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmNua3RrZGpvdGpidGRqem53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NTE3OTgsImV4cCI6MjA5MTQyNzc5OH0.ZPVyfehHS6KCTKthlc9hv2kzzQX-G28Z3JubWQpteKA";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_KEY = "guild_chat_session";
const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000;

let myNick = "",
    masterKey = "",
    lastTimestamp = null,
    isLoadedAll = false;
let replyId = null,
    editingId = null;

let currentUser = null;

let tempAvatarUrl = "";
let selectedFiles = [];

const msgField = document.getElementById('msg-field');