/* app.js */
let tracks = [];
let currentTrack = 0;
let lastSecond = -1;

const booksBtn     = document.getElementById("booksBtn");
const refreshBtn   = document.getElementById("refreshBtn");
const recentsBtn   = document.getElementById("recentsBtn");
const bmkBtn       = document.getElementById("bmkBtn");
const bmkViewBtn   = document.getElementById("bmkViewBtn");
const trkTitleBtn  = document.getElementById("trkTitleBtn");
const playPauseBtn = document.getElementById("playPauseBtn");

const audio = document.getElementById("audio");
const currentTimeDisplay = document.getElementById("currentTime");
const coverImage = document.getElementById("cover");
const chapterList = document.getElementById("chapterList");
const totalTimeDisplay = document.getElementById("totalTime");
const remainingTimeDisplay = document.getElementById("remainingTime");
let recentBooks = [];
let bookmarksByBook = {};
let bookHandles = {};
let dirHandle = {};

const DB_NAME = "audiobook-app";
const DB_VERSION = 1;
const STORE_NAME = "handles";

loadRecentBooks();
loadBookmarks();

// Setup service worker
setupServiceWorker();

window.addEventListener("DOMContentLoaded", async () => {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  dirHandle = await getStoredDirectoryHandle();
  if (!dirHandle) {
    disableBtns(['booksBtn','recentsBtn','bmkBtn','bmkViewBtn'], true);
    // ['booksBtn','recentsBtn','bmkBtn','bmkViewBtn'].forEach(btnID => {
    //   disableBtn(btnID, true);
    //   document.getElementById(btnID).disabled = true;
    // });
    return
  };

  // Check for permission before reading directory
  let permission = await dirHandle.queryPermission({ mode: "read" });
  if (permission !== "granted") {
    permission = await dirHandle.requestPermission({ mode: "read" });
  }

  if (permission === "granted") {
    await readBooksFromDirectory(dirHandle);

    const lastBook = localStorage.getItem("lastBook");
    if (lastBook && bookHandles[lastBook]) {
      // console.log('permission: ', permission);//DEBUG
      // console.log('loadBook: ', lastBook);//DEBUG
      // toggleBookList(true); // loads last book on start
      toggleOverlay(true);
      loadBook(lastBook);
      // loadBookmarks();

      if (Object.keys(bookHandles).length === 0) {
        disableBtns(['booksBtn'], true);
      }
      if (recentBooks.length === 0) {
        disableBtns(['recentsBtn'], true);
      }
    }

    // console.log(lastBook);
    if (!bookmarksByBook || !bookmarksByBook[lastBook]) {
      disableBtns(['bmkViewBtn'], true);
    }
  }
  else {
    console.warn("Permission to access directory was not granted.");
  }
});

// Button click events
booksBtn.addEventListener("click", () => {
  openOverlay('book');
});
refreshBtn.addEventListener("click", () => {
  selectBookRoot();
});
recentsBtn.addEventListener("click", () => {
    openOverlay('recent');
});
bmkBtn.addEventListener("click", () => {
  addBookmark();
});
bmkViewBtn.addEventListener("click", () => {
  openBookmarksOverlay();
});
trkTitleBtn.addEventListener("click", () => {
  openChaptersOverlay();
});

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


// *************************************************
// FUNCTIONS FUNCTIONS FUNCTIONS FUNCTIONS FUNCTIONS
// *************************************************

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
        // Enable button
        disableBtns(['booksBtn'], false);
        // Update default image
        coverImage.src = 'default2.png';
      }
    }

    // toggleOverlay(false);
  } catch (e) {
    console.error("Error reading directory", e);
  }
}

async function loadBook(folderName) {
  const folderHandle = bookHandles[folderName];
  if (!folderHandle) return;

  const files = [];
  for await (const entry of folderHandle.values()) {
    const file = await entry.getFile();
    files.push(file);
  }

  // console.log('Files:', files);

  // console.log(folderHandle.name);

  if (bookmarksByBook[folderHandle.name]) {
    disableBtns(['bmkViewBtn'], false);
  }
  else {
    disableBtns(['bmkViewBtn'], true);
  }

  // Save to recentBooks
  if (!recentBooks.includes(folderName)) {
    recentBooks.unshift(folderName);
    if (recentBooks.length > 6) recentBooks.pop();
    saveRecentBooks();

    // Enable button
    disableBtns(['bmkBtn'], false);
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

  if (imageFile) {
    coverImage.src = URL.createObjectURL(imageFile);
    coverImage.classList.remove("hidden");
  } else {
    coverImage.classList.add("hidden");
  }

  document.title = folderName;
  // loadTrack(0);

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

// Used to refresh books from directory
async function selectBookRoot() {
  try {
    dirHandle = await window.showDirectoryPicker();
    await saveDirectoryHandle(dirHandle);
    await readBooksFromDirectory(dirHandle);
  } catch (err) {
    console.error("Directory access cancelled or failed", err);
  }
}

function disableBtns(arrIDs, trueFalse) {
  arrIDs.forEach(btnID => {
    disableBtn(btnID, trueFalse);
    document.getElementById(btnID).disabled = trueFalse;
  });
}

function disableBtn(btnID, flag) {
  let btn = document.getElementById(btnID);
  if (flag) {
    btn.classList.remove("navActive");
    btn.classList.add("navDisable");
  } else {
    btn.classList.remove("navDisable");
    btn.classList.add("navActive");
  }
}

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

// function refreshBooks() {
//   selectBookRoot();
// }

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

  disableBtns(['bmkViewBtn'], false);

  saveBookmarks();
}

function openBookmarksOverlay() {
  stored = localStorage.getItem("bookmarksByBook");
  bookmarksByBook = stored ? JSON.parse(stored) : {};

  console.log(document.title);
  
  const bookName = document.title;
  const bookmarks = bookmarksByBook[bookName] || [];
  
  const title = document.getElementById("overlayTitle")
  title.innerHTML = 'Bookmarks';
  
  const list = document.getElementById("overlayList");
  list.innerHTML = "";

  bookmarks.forEach((b, i) => {
    const li = document.createElement("li");
    li.className = "flex items_center justify_between";

    const button = document.createElement("button");
    button.textContent = b.label;
    button.className = "txt_blue_500";
    button.addEventListener("click", () => {
      seekToBookmark(b);
      toggleOverlay(true); // hide overlay after click
    });

    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = "✕";
    removeBtn.className = "text_red_600 ml_4 text_3xl";
    removeBtn.addEventListener("click", () => {
      removeBookmark(bookName, i);
    });

    li.appendChild(button);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
  toggleOverlay(false); // show overlay
}

// Refactored to combine books & recent views
async function openOverlay(view) {
  let title = document.getElementById("overlayTitle")
  let list = document.getElementById("overlayList");
  title.innerHTML = "";
  list.innerHTML = "";
  
  let arr = [];
  if ('recent' == view && recentBooks.length > 0) {
    title.innerHTML = 'Recent Audio Books';
    arr = recentBooks;
  }
  else if ('book' == view && Object.keys(bookHandles).length > 0) {
    title.innerHTML = 'Select Audio Book';
    arr = Object.keys(bookHandles);
  }

  if (title.innerHTML) {
    list.innerHTML = arr.map((book, i) => {
      let rmvBtn = '';
      let selectFnc = 'selectNewBook()';
      if ('recent' == view) {
        rmvBtn = `<button class="text_red_500 text_3xl" onclick="removeRecentBook('${book}')">✕</button>`;
        selectFnc = 'toggleOverlay(true)';
      }
      return `
        <li style="display: flex; align-items: center; padding-bottom: .5rem; gap: 0.5rem;">
          <img id="cover${i}" class="covers" src="" alt="Cover">
          <div style="flex-grow: 1; list-style-type: none;" class="book_title" onclick="loadBook('${book}'); ${selectFnc}">${book}</div>
          ${rmvBtn}
        </li>`
    }).join("");

    // Required to render book cover thumbs
    let rootHandle = await getStoredDirectoryHandle();
    if (rootHandle) {
      for (let i = 0; i < arr.length; i++) {
        const bookName = arr[i];
        try {
          const bookDirHandle = await rootHandle.getDirectoryHandle(bookName);
          const coverFileHandle = await bookDirHandle.getFileHandle("cover.jpg");
          const file = await coverFileHandle.getFile();
          const url = URL.createObjectURL(file);

          // Set the image src
          document.getElementById(`cover${i}`).src = url;
        } catch (e) {
          console.warn(`Could not load cover for ${bookName}:`, e);
          document.getElementById(`cover${i}`).alt = "No cover";
        }
      }
    }
    toggleOverlay(false); // show overlay
  }
}

function openChaptersOverlay() {
  const title = document.getElementById("overlayTitle")
  title.innerHTML = 'Select Chapter';

  const list = document.getElementById("overlayList");
  list.innerHTML = "";

  list.innerHTML = tracks.map((t, i) =>
    `<li class="p_2" style="list-style-type: none;" onclick="loadTrack(${i}); toggleOverlay(true)">${t.title}</li>`
  ).join("");

  toggleOverlay(false);
}

function selectNewBook() {
  disableBtns(['recentsBtn'], false);
  toggleOverlay(true);
}

function toggleOverlay(forceHide = null) {
  const overlay = document.getElementById("overlay");
  if (forceHide !== null) {
    overlay.classList.toggle("hidden", forceHide);
  } else {
    overlay.classList.toggle("hidden");
  }
}

function seekToBookmark(bookmark) {
  if (bookmark.trackIndex !== currentTrack) {
    loadTrack(bookmark.trackIndex);
  }
  audio.currentTime = bookmark.time;
  audio.play();
  playPauseBtn.textContent = "pause";
}

function saveBookmarks() {
  localStorage.setItem("bookmarksByBook", JSON.stringify(bookmarksByBook));
}

function loadBookmarks() {
  const stored = localStorage.getItem("bookmarksByBook");
  bookmarksByBook = stored ? JSON.parse(stored) : {};
}

function removeRecentBook(folderName) {
  recentBooks = recentBooks.filter(name => name !== folderName);
  saveRecentBooks();

  if (recentBooks.length === 0) {
    disableBtns(['recentsBtn'], true);
    toggleOverlay(true); // hide overlay
  } else {
    openOverlay('recent'); // Re-render the list
  }
}

function removeBookmark(bookName, index) {
  if (!bookmarksByBook[bookName]) return;

  // console.log(bookmarksByBook);

  bookmarksByBook[bookName].splice(index, 1);
  if (bookmarksByBook[bookName].length === 0) {
    delete bookmarksByBook[bookName]; // clean up empty list
  }

  saveBookmarks();
  openBookmarksOverlay(); // refresh list
}

function saveRecentBooks() {
  localStorage.setItem("recentBooks", JSON.stringify(recentBooks));
}

function loadRecentBooks() {
  const stored = localStorage.getItem("recentBooks");
  if (stored) recentBooks = JSON.parse(stored);
}

// function toggleBookListRecent(forceHide = null) {
  // if (forceHide !== null) {
  //   bookListRecent.classList.toggle("hidden", forceHide);
  //   toggleOverlay(true);
  // } else {
  //   bookListRecent.classList.toggle("hidden");
  // }
// }

function loadTrack(index) {
  currentTrack = index;
  const track = tracks[currentTrack];
  audio.src = track.file;
  trkTitleBtn.textContent = track.title.slice(0, -4); // Remove '.mp3' from title name
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
