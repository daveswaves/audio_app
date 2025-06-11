/* app.js */
let tracks = [];
let currentTrack = 0;
const audio = document.getElementById("audio");
const playPauseBtn = document.getElementById("playPause");
// const chapterSelector = document.getElementById("chapterSelector");
const trackTitle = document.getElementById("trackTitle");
const currentTimeDisplay = document.getElementById("currentTime");
const coverImage = document.getElementById("cover");
// const folderPicker = document.getElementById("folderPicker");
const chapterList = document.getElementById("chapterList");
const chapterListItems = document.getElementById("chapterListItems");
const totalTimeDisplay = document.getElementById("totalTime");
const remainingTimeDisplay = document.getElementById("remainingTime");

const bookRootPicker = document.getElementById("bookRootPicker");
const bookList = document.getElementById("bookList");
const bookListItems = document.getElementById("bookListItems");
let allFilesByFolder = {};

// Setup service worker
// setupServiceWorker();

bookRootPicker.addEventListener("change", (e) => {
  const files = Array.from(e.target.files);
  allFilesByFolder = {};

  files.forEach(file => {
    const parts = file.webkitRelativePath.split("/");
    const folder = parts[1]; // [0] = root ("AudioBook"), [1] = audiobook folder
    if (!allFilesByFolder[folder]) allFilesByFolder[folder] = [];
    allFilesByFolder[folder].push(file);
  });

  // Show book list
  bookListItems.innerHTML = Object.keys(allFilesByFolder).map(folder =>
    `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="loadBook('${folder}'); toggleBookList(true)">${folder}</li>`
  ).join("");

  toggleBookList(false);
});


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

function loadBook(folderName) {
  const files = allFilesByFolder[folderName];
  if (!files) return;

  const audioFiles = files.filter(f => f.type.startsWith("audio/"));
  const imageFile = files.find(f => f.type.startsWith("image/"));

  tracks = audioFiles.sort((a, b) => a.name.localeCompare(b.name)).map((file, i) => ({
    title: file.name,
    file: URL.createObjectURL(file)
  }));

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

function toggleBookList(forceHide = null) {
  if (forceHide !== null) {
    bookList.classList.toggle("hidden", forceHide);
  } else {
    bookList.classList.toggle("hidden");
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


audio.addEventListener("loadedmetadata", () => {
  let mins = Math.floor(audio.duration / 60);
  let secs = Math.floor(audio.duration % 60).toString().padStart(2, "0");
  remainingTimeDisplay.textContent = `${mins}:${secs}`;
  currentTimeDisplay.textContent = '0:00';
});

let lastSecond = -1;

audio.addEventListener("timeupdate", () => {
  const currentRounded = Math.floor(audio.currentTime);
  
  // Only update when the second actually changes
  if (currentRounded === lastSecond) return;
  lastSecond = currentRounded;
  
  const remaining = Math.max(Math.floor(audio.duration) - currentRounded, 0);
  
  const mins = Math.floor(currentRounded / 60);
  const secs = Math.floor(currentRounded % 60).toString().padStart(2, "0");
  
  if (!isNaN(remaining)) {
    const minsRem = Math.floor(remaining / 60);
    const secsRem = Math.floor(remaining % 60).toString().padStart(2, "0");
    
    currentTimeDisplay.textContent = `${mins}:${secs}`;
    remainingTimeDisplay.textContent = `${minsRem}:${secsRem}`;
  
    // DEBUG
    // console.log(`Current: ${mins}:${secs}, Remaining: ${minsRem}:${secsRem}`);
  }
});
