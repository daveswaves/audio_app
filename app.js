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
let allFilesByFolder = {};
let recentBooks = [];

loadRecentBooks();

// Setup service worker
// setupServiceWorker();

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

async function selectBookRoot() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    allFilesByFolder = {};

    for await (const [bookName, bookHandle] of dirHandle.entries()) {
      if (bookHandle.kind === "directory") {
        allFilesByFolder[bookName] = [];

        // for await (const [fileName, fileHandle] of bookHandle.entries()) {
        //   const file = await fileHandle.getFile();
        //   allFilesByFolder[bookName].push(file);
        // }
        for await (const fileEntry of bookHandle.values()) {
          // console.log(fileEntry);
          const file = await fileEntry.getFile();
          allFilesByFolder[bookName].push(file);
        }
      }
    }
    
    // Populate book list
    bookListItems.innerHTML = Object.keys(allFilesByFolder).map(folder =>
      `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="loadBook('${folder}'); toggleBookList(true)">${folder}</li>`
    ).join("");

    toggleBookList(false);
  } catch (err) {
    console.error("Directory access cancelled or failed", err);
  }
}

function handleBookButtonClick() {
  if (Object.keys(allFilesByFolder).length > 0) {
    toggleBookList(false); // Show the list immediately
  } else {
    document.getElementById("bookRootTrigger").click(); // Trigger hidden button
  }
}

function loadBook(folderName) {
  const files = allFilesByFolder[folderName];
  if (!files) return;

  // Add to recentBooks list
  if (!recentBooks.includes(folderName)) {
    recentBooks.unshift(folderName);
    if (recentBooks.length > 6) recentBooks.pop(); // Keep only last 6

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

  // Calulate total duration of audio book
  Promise.all(
    tracks.map(t => {
      return new Promise(resolve => {
        const audioEl = document.createElement("audio");
        audioEl.preload = "metadata";
        audioEl.src = t.file;
        audioEl.onloadedmetadata = () => resolve(audioEl.duration || 0);
      });
    })
  ).then(durations => {
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
}

function handleRecentButtonClick() {
  if (recentBooks.length === 0) {
    bookListItemsRecent.innerHTML = "<p>Empty</p>";
  } else {
    bookListItemsRecent.innerHTML = recentBooks.map(folder =>
      `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="loadBook('${folder}'); toggleBookListRecent(true)">${folder}</li>`
    ).join("");
  }

  toggleBookListRecent(false); // Show the recent book list
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
  
    // DEBUG
    // console.log(`Current: ${mins}:${secs}, Remaining: ${minsRem}:${secsRem}`);
  }
});
