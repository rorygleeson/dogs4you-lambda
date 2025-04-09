const AWS = require('aws-sdk');
const https = require('https');
const fs = require('fs');
const path = require('path');

// YouTube API Key
const API_KEY = 'AIzaSyBK3tknA6n4eNcDhcGjbOxYgJ7RH05o4lw';
const MAX_RESULTS = 200;
const S3_BUCKET = 'doggyhits.com';

// Initialize S3 client
const s3 = new AWS.S3();

// Function to fetch dog videos from YouTube API
async function fetchDogVideos() {
    return new Promise((resolve, reject) => {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=${MAX_RESULTS}&q=funny+dogs&type=video&order=date&key=${API_KEY}`;
        
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.error) {
                        reject(new Error(`YouTube API Error: ${jsonData.error.message}`));
                    } else {
                        resolve(jsonData);
                    }
                } catch (error) {
                    reject(new Error(`Error parsing YouTube API response: ${error.message}`));
                }
            });
        }).on('error', (error) => {
            reject(new Error(`Error fetching videos: ${error.message}`));
        });
    });
}

// Function to convert date to Australia EST time
function convertToAustraliaEST(date) {
    const options = {
        timeZone: 'Australia/Sydney',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    
    return date.toLocaleString('en-AU', options);
}

// Function to generate HTML content
function generateHTML(videos) {
    // Get the most recent video for the timestamp
    let lastUpdatedText = 'Last video updated: No videos found';
    
    if (videos.items && videos.items.length > 0) {
        const mostRecentVideo = videos.items[0];
        const publishDate = new Date(mostRecentVideo.snippet.publishedAt);
        const australiaTime = convertToAustraliaEST(publishDate);
        lastUpdatedText = `Last video updated: ${australiaTime}`;
    }
    
    // Generate video items HTML
    let videoItemsHTML = '';
    
    if (videos.items && videos.items.length > 0) {
        videos.items.forEach(video => {
            const videoId = video.id.videoId;
            const snippet = video.snippet;
            const title = snippet.title;
            const description = snippet.description;
            const thumbnailUrl = snippet.thumbnails.high.url || snippet.thumbnails.medium.url || snippet.thumbnails.default.url;
            const publishDate = new Date(snippet.publishedAt);
            
            videoItemsHTML += `
                <div class="video-item" data-video-id="${videoId}" data-title="${title.replace(/"/g, '&quot;')}" data-description="${description.replace(/"/g, '&quot;')}">
                    <div class="thumbnail-container">
                        <img class="thumbnail" src="${thumbnailUrl}" alt="${title.replace(/"/g, '&quot;')}">
                        <div class="play-icon"><i class="fas fa-play-circle"></i></div>
                    </div>
                    <div class="video-info">
                        <h3>${title}</h3>
                        <p>Uploaded: ${publishDate.toLocaleDateString()}</p>
                        <span class="played-indicator">Played</span>
                    </div>
                </div>
            `;
        });
    } else {
        videoItemsHTML = '<p class="error-message">No dog videos found. Please try again later.</p>';
    }
    
    // Complete HTML template
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Funny Dog Videos</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
        /* Styles for watched videos indicator */
        .played-indicator {
            display: none;
            font-size: 0.8em;
            color: #555;
            background-color: #f1f1f1;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 5px;
            font-weight: bold;
        }
        
        .video-item.watched .played-indicator {
            display: inline-block;
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <h1>Funny Dog Videos</h1>
            <p> Doggy Dopamine Hits !!!!! </p>
           
            <p id="last-updated" class="last-updated">${lastUpdatedText}</p>
        </div>
    </header>

    <main class="container">
        <div id="videos-container" class="videos-grid">
            ${videoItemsHTML}
        </div>

        <div id="video-modal" class="modal">
            <div class="modal-content">
                <span class="close-button">&times;</span>
                <div id="video-player"></div>
                <div id="video-info">
                    <h3 id="video-title"></h3>
                    <p id="video-description"></p>
                </div>
            </div>
        </div>
    </main>

    <footer>
        <div class="container">
            <p>&copy; 2025 DoggyHits - All rights reserved</p>
        </div>
    </footer>

    <script>
        // Modal functionality
        const videoModal = document.getElementById('video-modal');
        const closeButton = document.querySelector('.close-button');
        const videoPlayer = document.getElementById('video-player');
        const videoTitle = document.getElementById('video-title');
        const videoDescription = document.getElementById('video-description');
        
        // Global variable to store YouTube player instance
        let youtubePlayer = null;
        let videoEndTimer = null;
        
        // Cookie functions for persistence
        function setCookie(name, value, days) {
            const expires = new Date();
            expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
            document.cookie = name + '=' + value + ';expires=' + expires.toUTCString() + ';path=/';
        }
        
        function getCookie(name) {
            const nameEQ = name + '=';
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i];
                while (c.charAt(0) === ' ') c = c.substring(1, c.length);
                if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
            }
            return null;
        }
        
        // Track watched videos with Set and cookie persistence
        const watchedVideos = new Set();
        
        // Load watched videos from cookie on page load
        function loadWatchedVideosFromCookie() {
            const watchedCookie = getCookie('doggyHitsWatched');
            if (watchedCookie) {
                try {
                    const watchedArray = JSON.parse(watchedCookie);
                    watchedArray.forEach(videoId => watchedVideos.add(videoId));
                } catch (e) {
                    console.error('Error parsing watched videos cookie:', e);
                }
            }
        }
        
        // Save watched videos to cookie
        function saveWatchedVideosToCookie() {
            const watchedArray = Array.from(watchedVideos);
            setCookie('doggyHitsWatched', JSON.stringify(watchedArray), 30); // Store for 30 days
        }
        
        // Load watched videos when page loads
        loadWatchedVideosFromCookie();
        
        // Add click event to all video items
        document.querySelectorAll('.video-item').forEach(item => {
            item.addEventListener('click', () => {
                const videoId = item.dataset.videoId;
                const title = item.dataset.title;
                const description = item.dataset.description;
                
                // Mark video as watched
                watchedVideos.add(videoId);
                item.classList.add('watched');
                
                // Save to cookie
                saveWatchedVideosToCookie();
                
                openVideoModal(videoId, title, description, item);
            });
        });
        
        // Close modal when clicking close button
        closeButton.addEventListener('click', closeModal);
        
        // Close modal when clicking outside content
        window.addEventListener('click', (e) => {
            if (e.target === videoModal) {
                closeModal();
            }
        });
        
        // Open modal and play video
        function openVideoModal(videoId, title, description, videoItem) {
            // Clear any existing timers
            if (videoEndTimer) {
                clearTimeout(videoEndTimer);
                videoEndTimer = null;
            }
            
            // Set video player iframe with event listener for video end
            videoPlayer.innerHTML = \`
                <iframe 
                    id="youtube-iframe"
                    src="https://www.youtube.com/embed/\${videoId}?autoplay=1&enablejsapi=1" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
                </iframe>
            \`;
            
            // Set video information
            videoTitle.textContent = title;
            videoDescription.textContent = description;
            
            // Show modal
            videoModal.style.display = 'block';
            
            // Disable scrolling on body
            document.body.style.overflow = 'hidden';
            
            // Add YouTube API script if not already added
            if (!window.YT) {
                const tag = document.createElement('script');
                tag.src = 'https://www.youtube.com/iframe_api';
                const firstScriptTag = document.getElementsByTagName('script')[0];
                firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
            }
            
            // Initialize YouTube player when API is ready
            window.onYouTubeIframeAPIReady = function() {
                initializeYouTubePlayer(videoId);
            };
            
            // If YouTube API is already loaded, initialize player directly
            if (window.YT && window.YT.Player) {
                initializeYouTubePlayer(videoId);
            }
        }
        
        // Initialize YouTube player with API
        function initializeYouTubePlayer(videoId) {
            try {
                const iframe = document.getElementById('youtube-iframe');
                if (iframe) {
                    youtubePlayer = new YT.Player('youtube-iframe', {
                        events: {
                            'onStateChange': onPlayerStateChange,
                            'onReady': onPlayerReady
                        }
                    });
                }
            } catch (error) {
                console.error('Error initializing YouTube player:', error);
            }
        }
        
        // When player is ready, set up time monitoring
        function onPlayerReady(event) {
            // Start monitoring video time
            monitorVideoTime();
        }
        
        // Monitor video time to show controls near the end
        function monitorVideoTime() {
            if (youtubePlayer && youtubePlayer.getPlayerState) {
                const playerState = youtubePlayer.getPlayerState();
                
                // Only monitor if video is playing (state 1)
                if (playerState === 1) {
                    const duration = youtubePlayer.getDuration();
                    const currentTime = youtubePlayer.getCurrentTime();
                    const timeRemaining = duration - currentTime;
                    
                    // If less than 2 seconds remaining, show controls
                    if (timeRemaining <= 2 && timeRemaining > 0) {
                        youtubePlayer.unMute(); // Ensure audio is on
                        youtubePlayer.playVideo(); // Ensure video is playing
                        
                        // Show controls by sending a user activity event
                        try {
                            const iframe = document.getElementById('youtube-iframe');
                            if (iframe && iframe.contentWindow) {
                                iframe.contentWindow.postMessage('{"event":"command","func":"showControls","args":""}', '*');
                            }
                        } catch (e) {
                            console.error('Error showing controls:', e);
                        }
                    }
                }
                
                // Continue monitoring every 200ms
                setTimeout(monitorVideoTime, 200);
            }
        }
        
        // Handle player state changes
        function onPlayerStateChange(event) {
            // State 0 means the video has ended
            if (event.data === 0) {
                // Add a 1-second delay before closing
                videoEndTimer = setTimeout(() => {
                    closeModal();
                }, 1000);
            }
        }
        
        // Close modal
        function closeModal() {
            // Clear any existing timers
            if (videoEndTimer) {
                clearTimeout(videoEndTimer);
                videoEndTimer = null;
            }
            
            // Reset YouTube player variable
            youtubePlayer = null;
            
            // Clear video player
            videoPlayer.innerHTML = '';
            
            // Hide modal
            videoModal.style.display = 'none';
            
            // Enable scrolling on body
            document.body.style.overflow = 'auto';
        }
        
        // Apply watched status to videos on page load
        function applyWatchedStatus() {
            document.querySelectorAll('.video-item').forEach(item => {
                const videoId = item.dataset.videoId;
                if (watchedVideos.has(videoId)) {
                    item.classList.add('watched');
                }
            });
        }
        
        // Apply watched status when page loads
        applyWatchedStatus();
    </script>
</body>
</html>`;
}

// Function to upload file to S3
async function uploadToS3(content, key, contentType) {
    const params = {
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: contentType
    };
    
    return s3.putObject(params).promise();
}

// Main Lambda handler
exports.handler = async (event) => {
    try {
        console.log('Starting DoggyHits Lambda function');
        
        // Fetch videos from YouTube API
        console.log('Fetching videos from YouTube API');
        const videos = await fetchDogVideos();
        
        // Generate HTML content
        console.log('Generating HTML content');
        const htmlContent = generateHTML(videos);
        
        // Upload HTML to S3
        console.log('Uploading index.html to S3');
        await uploadToS3(htmlContent, 'index.html', 'text/html');
        
        console.log('Successfully updated DoggyHits website');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Successfully updated DoggyHits website' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
