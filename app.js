/* app.js */
let tracks = [];
let currentTrack = 0;
const audio = document.getElementById("audio");
const playPauseBtn = document.getElementById("playPause");
const trackTitle = document.getElementById("trackTitle");
const currentTimeDisplay = document.getElementById("currentTime");
const coverImage = document.getElementById("cover");
const chapterList = document.getElementById("chapterList");
const chapterListItems = document.getElementById("chapterListItems");
const totalTimeDisplay = document.getElementById("totalTime");
const remainingTimeDisplay = document.getElementById("remainingTime");
const bookList = document.getElementById("bookList");
const bookListItems = document.getElementById("bookListItems");
const bookListItemsRecent = document.getElementById("bookListItemsRecent");
// let allFilesByFolder = {};
let recentBooks = [];
let bookmarksByBook = {}; // bookmarks code
let bookHandles = {};


const DB_NAME = "audiobook-app";
const DB_VERSION = 1;
const STORE_NAME = "handles";

loadRecentBooks();
loadBookmarks(); // bookmarks code

// Setup service worker
setupServiceWorker();

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(registration => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        })
        .catch(error => {
          console.log('ServiceWorker registration failed: ', error);
        });
    });
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }
  
  const dirHandle = await getStoredDirectoryHandle();
  if (!dirHandle) return;

  // Check for permission before reading directory
  let permission = await dirHandle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    permission = await dirHandle.requestPermission({ mode: "read" });
  }

  
  if (permission === "granted") {
    await readBooksFromDirectory(dirHandle);
    
    const lastBook = localStorage.getItem("lastBook");
    if (lastBook && bookHandles[lastBook]) {
      console.log('permission: ', permission);//DEBUG
      console.log('loadBook: ', lastBook);//DEBUG
      toggleBookList(true); // loads last book on start
      loadBook(lastBook);
      // loadBookmarks();
    }
  } else {
    console.warn("Permission to access directory was not granted.");
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// Allows bookList to be updated if extra audio books have been uploaded
function refreshBooks() {
  selectBookRoot();
}

async function saveDirectoryHandle(handle) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(handle, "bookRoot");
  return tx.complete;
}

async function getStoredDirectoryHandle() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const request = tx.objectStore(STORE_NAME).get("bookRoot");
  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const handle = request.result;
      if (handle) {
        const permission = await handle.queryPermission({ mode: "read" });
        if (permission === "granted") {
          resolve(handle);
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

async function readBooksFromDirectory(dirHandle) {
  bookHandles = {};

  try {
    for await (const [bookName, bookHandle] of dirHandle.entries()) {
      if (bookHandle.kind === "directory") {
        bookHandles[bookName] = bookHandle;
      }
    }

    console.log("Books found:", Object.keys(bookHandles));

    bookListItems.innerHTML = Object.keys(bookHandles).map(folder =>
      `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="loadBook('${folder}'); toggleBookList(true)">${folder}</li>`
    ).join("");

    toggleBookList(false);
  } catch (e) {
    console.error("Error reading directory", e);
  }
}

async function loadBook(folderName) {
  // bookmarks code
  document.getElementById("bookListRecent").classList.add("hidden");
  
  const folderHandle = bookHandles[folderName];
  if (!folderHandle) return;

  const files = [];
  for await (const entry of folderHandle.values()) {
    const file = await entry.getFile();
    files.push(file);
  }

  // Save to recentBooks
  if (!recentBooks.includes(folderName)) {
    recentBooks.unshift(folderName);
    if (recentBooks.length > 6) recentBooks.pop();
    saveRecentBooks();
  }

  const audioFiles = files.filter(f => f.type.startsWith("audio/"));
  const imageFile = files.find(f => f.type.startsWith("image/"));

  tracks = audioFiles.sort((a, b) => a.name.localeCompare(b.name)).map((file, i) => ({
    title: file.name,
    file: URL.createObjectURL(file)
  }));

  document.getElementById("timeInf").classList.remove("hidden");
  document.getElementById("transCon").classList.remove("hidden");

  // Calculate total duration
  Promise.all(tracks.map(t => {
    return new Promise(resolve => {
      const audioEl = document.createElement("audio");
      audioEl.preload = "metadata";
      audioEl.src = t.file;
      audioEl.onloadedmetadata = () => resolve(audioEl.duration || 0);
    });
  })).then(durations => {
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    document.getElementById("bookTotalTime").textContent = hoursMinsSecs(totalDuration);
  });

  chapterListItems.innerHTML = tracks.map((t, i) =>
    `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="loadTrack(${i}); toggleChapterList(true)">${t.title}</li>`
  ).join("");

  if (imageFile) {
    coverImage.src = URL.createObjectURL(imageFile);
    coverImage.classList.remove("hidden");
  } else {
    coverImage.classList.add("hidden");
  }

  document.title = folderName;
  loadTrack(0);

  // Restore playback position
  const positionData = JSON.parse(localStorage.getItem("positions") || "{}");
  const savedPos = positionData[folderName];

  if (savedPos) {
    loadTrack(savedPos.trackIndex);
    audio.addEventListener("loadedmetadata", function restoreTime() {
      audio.currentTime = savedPos.time || 0;
      audio.removeEventListener("loadedmetadata", restoreTime);
    });
  }

  // Persist last opened book
  localStorage.setItem("lastBook", folderName);
}

async function selectBookRoot() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    await saveDirectoryHandle(dirHandle);
    await readBooksFromDirectory(dirHandle);
  } catch (err) {
    console.error("Directory access cancelled or failed", err);
  }
}

async function restoreBookRoot() {
  const dirHandle = await getStoredDirectoryHandle();

  if (!dirHandle) return;

  const permission = await dirHandle.queryPermission({ mode: "read" });
  if (permission === "granted") {
    await readBooksFromDirectory(dirHandle);
  } else {
    const reqPermission = await dirHandle.requestPermission({ mode: "read" });
    if (reqPermission === "granted") {
      await readBooksFromDirectory(dirHandle);
    } else {
      console.warn("Permission not granted to access directory");
    }
  }
}

// bookmarks code
function addBookmark() {
  const bookName = document.title;
  const time = Math.floor(audio.currentTime);
  const label = hoursMinsSecs(time);

  if (!bookmarksByBook[bookName]) {
    bookmarksByBook[bookName] = [];
  }

  bookmarksByBook[bookName].push({
    trackIndex: currentTrack,
    time,
    label
  });

  saveBookmarks();
}

// bookmarks code
function openBookmarksOverlay() {
  document.getElementById("bookmarksOverlay").classList.remove("hidden");
  const bookName = document.title;
  const bookmarks = bookmarksByBook[bookName] || [];

  const list = document.getElementById("bookmarksList");

  list.innerHTML = "";

  if (bookmarks.length === 0) {
    list.innerHTML = `<li class="text-gray-500 italic">No bookmarks yet.</li>`;
  } else {
    bookmarks.forEach((b, i) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between";
      
      const button = document.createElement("button");
      button.textContent = b.label;
      button.className = "text-blue-500 hover:underline";
      button.addEventListener("click", () => {
        seekToBookmark(b);
        toggleBookmarksOverlay(true); // hide overlay after click
      });

      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = "✕";
      removeBtn.className = "text-red-500 ml-4 text-xl";
      removeBtn.addEventListener("click", () => {
        removeBookmark(bookName, i);
      });

      li.appendChild(button);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  toggleBookmarksOverlay(false); // Show
}
// bookmarks code
function toggleBookmarksOverlay(forceHide = null) {
  const overlay = document.getElementById("bookmarksOverlay");
  if (forceHide !== null) {
    overlay.classList.toggle("hidden", forceHide);
  } else {
    overlay.classList.toggle("hidden");
  }
}

// bookmarks code
function seekToBookmark(bookmark) {
  if (bookmark.trackIndex !== currentTrack) {
    loadTrack(bookmark.trackIndex);
  }
  audio.currentTime = bookmark.time;
  audio.play();
  playPauseBtn.textContent = "pause";
}

// bookmarks code
function saveBookmarks() {
  localStorage.setItem("bookmarksByBook", JSON.stringify(bookmarksByBook));
}

// bookmarks code
function loadBookmarks() {
  const stored = localStorage.getItem("bookmarksByBook");
  bookmarksByBook = stored ? JSON.parse(stored) : {};
}


function handleBookButtonClick() {
  if (Object.keys(bookHandles).length > 0) {
    toggleBookList(false); // Show the list immediately
  } else {
    document.getElementById("bookRootTrigger").click(); // Trigger hidden button
  }
}

function handleRecentButtonClick() {
  if (recentBooks.length === 0) {
    bookListItemsRecent.innerHTML = "<p>Empty</p>";
  } else {
    bookListItemsRecent.innerHTML = recentBooks.map(folder =>
      `<li class="p-2 hover:bg-gray-100 flex justify-between items-center">
        <span class="cursor-pointer" onclick="loadBook('${folder}'); toggleBookListRecent(true)">${folder}</span>
        <button class="text-red-500 ml-2 mr-2 text-2xl" onclick="removeRecentBook('${folder}')">✕</button>
      </li>`
    ).join("");
  }

  toggleBookListRecent(false); // Show the recent book list
}

function removeRecentBook(folderName) {
  recentBooks = recentBooks.filter(name => name !== folderName);
  saveRecentBooks();
  handleRecentButtonClick(); // Re-render the list
}

function removeBookmark(bookName, index) {
  if (!bookmarksByBook[bookName]) return;

  bookmarksByBook[bookName].splice(index, 1);
  if (bookmarksByBook[bookName].length === 0) {
    delete bookmarksByBook[bookName]; // clean up empty list
  }

  saveBookmarks();
  openBookmarksOverlay(); // refresh list
}

// Save recent books to localStorage
function saveRecentBooks() {
  localStorage.setItem("recentBooks", JSON.stringify(recentBooks));
}

// Load recent books from localStorage
function loadRecentBooks() {
  const stored = localStorage.getItem("recentBooks");
  if (stored) recentBooks = JSON.parse(stored);
}

function toggleBookList(forceHide = null) {
  if (forceHide !== null) {
    bookList.classList.toggle("hidden", forceHide);
  } else {
    bookList.classList.toggle("hidden");
  }
}

function toggleBookListRecent(forceHide = null) {
  if (forceHide !== null) {
    bookListRecent.classList.toggle("hidden", forceHide);
  } else {
    bookListRecent.classList.toggle("hidden");
  }
}

function loadTrack(index) {
  currentTrack = index;
  const track = tracks[currentTrack];
  audio.src = track.file;
  trackTitle.textContent = track.title;
  audio.load();
  playPauseBtn.textContent = "play";
}

function togglePlay() {
  if (audio.paused) {
    audio.play();
    playPauseBtn.textContent = "pause";
  } else {
    audio.pause();
    playPauseBtn.textContent = "play";
  }
}

function skipTime(seconds) {
  audio.currentTime += seconds;
}

function prevTrack() {
  if (currentTrack > 0) loadTrack(currentTrack - 1);
}

function nextTrack() {
  if (currentTrack < tracks.length - 1) loadTrack(currentTrack + 1);
}

trackTitle.addEventListener("click", () => {
  toggleChapterList();
});

function toggleChapterList(forceHide = null) {
  if (forceHide !== null) {
    chapterList.classList.toggle("hidden", forceHide);
  } else {
    chapterList.classList.toggle("hidden");
  }
}

function hoursMinsSecs(time) {
  let hours = Math.floor(time / 3600);
  let mins = Math.floor((time % 3600) / 60).toString().padStart(2, "0");
  // let mins = Math.floor(time / 60);
  let secs = Math.floor(time % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${mins}:${secs}` : `${mins}:${secs}`;
}

function savePlaybackPosition() {
  const lastBook = localStorage.getItem("lastBook");
  if (!lastBook) return;

  const positionData = JSON.parse(localStorage.getItem("positions") || "{}");
  positionData[lastBook] = {
    trackIndex: currentTrack,
    time: audio.currentTime
  };
  localStorage.setItem("positions", JSON.stringify(positionData));
}



let lastSecond = -1;

audio.addEventListener("loadedmetadata", () => {
  remainingTimeDisplay.textContent = hoursMinsSecs(audio.duration);
  currentTimeDisplay.textContent = '0:00';
});

// Auto-play next track
audio.addEventListener("ended", () => {
  if (currentTrack < tracks.length - 1) {
    loadTrack(currentTrack + 1);
    setTimeout(() => {
      audio.play();
      playPauseBtn.textContent = "pause";
    }, 500);
  }
});

audio.addEventListener("timeupdate", () => {
  const currentRounded = Math.floor(audio.currentTime);
  
  // Only update when the second actually changes
  if (currentRounded === lastSecond) return;
  lastSecond = currentRounded;
  
  const remaining = Math.max(Math.floor(audio.duration) - currentRounded, 0);
  
  if (!isNaN(remaining)) {
    currentTimeDisplay.textContent = hoursMinsSecs(currentRounded);
    remainingTimeDisplay.textContent =  `-${hoursMinsSecs(remaining)}`;
  }
});

// Save playback position on pause or exit
audio.addEventListener("pause", savePlaybackPosition);
window.addEventListener("beforeunload", savePlaybackPosition);
