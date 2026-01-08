let isSending = false;
window.selectedKnowledge = "";
let recognition = null;
let isRecognizing = false;
const AVATAR_FILE_EXT = ".png";
let currentAvatar = "lisa";
let lastEmotion = "default";
let cameraVoiceEnabled = false;
let lastVoiceStartTime = null;

async function sendToAI(chatText, source = "text", voiceDuration = null) {
    if (!chatText || isSending) return;

    const sendButton = document.getElementById("sendButton");
    isSending = true;
    if (sendButton) {
        sendButton.disabled = true;
    }

    const responseArea = document.getElementById("responseArea");
    const userMessage = document.createElement("div");
    userMessage.className = "message " + (source === "voice" ? "voice-message" : "user-message");
    if (source === "voice") {
        const bubble = document.createElement("div");
        bubble.className = "voice-bubble";
        const icon = document.createElement("span");
        icon.className = "voice-icon";
        icon.textContent = "🔊";
        const durationSpan = document.createElement("span");
        durationSpan.className = "voice-duration";
        const duration = voiceDuration && Number.isFinite(voiceDuration) ? voiceDuration : 3;
        durationSpan.textContent = `${duration}"`;
        bubble.appendChild(icon);
        bubble.appendChild(durationSpan);
        const transcriptDiv = document.createElement("div");
        transcriptDiv.className = "voice-transcript";
        transcriptDiv.textContent = chatText;
        userMessage.appendChild(bubble);
        userMessage.appendChild(transcriptDiv);
    } else {
        userMessage.textContent = chatText;
    }
    responseArea.appendChild(userMessage);
    responseArea.scrollTop = responseArea.scrollHeight;

    try {
        const resp = await fetch(`/chat?query=${encodeURIComponent(chatText)}&knowledge=${encodeURIComponent(window.selectedKnowledge || "")}`, {
            method: "POST"
        });
        if (!resp.ok) {
            throw new Error(`status ${resp.status}`);
        }
        const data = await resp.json();
        const item = Array.isArray(data) && data.length > 0 ? data[0] : { msg: "服务返回格式错误", qingxu: "default", emotion_probs: {} };
        const botMessage = document.createElement("div");
        botMessage.className = "message bot-message";
        botMessage.textContent = item.msg;
        responseArea.appendChild(botMessage);
        responseArea.scrollTop = responseArea.scrollHeight;

        // 更新情绪柱状图
        if (item.emotion_probs) {
            updateSentimentChart(item.emotion_probs);
        }

        // 更新数字人表情
        if (item.qingxu) {
            updateAvatarExpression(item.qingxu);
        }
    } catch (e) {
        console.error("请求失败", e);
        const botMessage = document.createElement("div");
        botMessage.className = "message bot-message";
        botMessage.textContent = "请求失败，请稍后重试。";
        responseArea.appendChild(botMessage);
        responseArea.scrollTop = responseArea.scrollHeight;
    } finally {
        isSending = false;
        if (sendButton) {
            sendButton.disabled = false;
        }
    }
}

async function chatWithAI() {
    const chatInput = document.getElementById("chatInput");
    const chatText = chatInput.value.trim();
    chatInput.value = "";
    chatInput.focus();
    await sendToAI(chatText, "text");
}

async function loadKnowledgeBases() {
    try {
        const response = await fetch("/api/knowledge-bases");
        const data = await response.json();
        const select = document.getElementById("knowledgeSelect");
        select.innerHTML = '<option value="">选择知识库</option>';
        data.forEach(item => {
            const value = typeof item === "string" ? item : item.name || item.value;
            if (!value) return;
            const option = document.createElement("option");
            option.value = value;
            option.text = value;
            select.appendChild(option);
        });
        window.selectedKnowledge = select.value;
    } catch (e) {
        console.error("加载知识库列表失败", e);
    }
}

async function checkVectorizationProgress() {
    try {
        const response = await fetch("/api/vectorization-progress");
        const data = await response.json();
        const progressBar = document.querySelector(".progress-bar");
        const progressElement = progressBar.querySelector(".progress");
        const statusElement = document.querySelector(".progress-status");

        if (data.status === "processing") {
            progressBar.style.display = "block";
            statusElement.style.display = "block";
            progressElement.style.width = `${data.percentage}%`;
            statusElement.textContent = `正在处理: ${data.file} (${Math.round(data.percentage)}%)`;
            setTimeout(checkVectorizationProgress, 1000);
        } else if (data.status === "completed") {
            progressBar.style.display = "none";
            statusElement.style.display = "none";
            loadKnowledgeBases();
        } else if (data.status === "error") {
            progressBar.style.display = "none";
            statusElement.style.display = "block";
            statusElement.textContent = `处理失败: ${data.error}`;
            setTimeout(() => {
                statusElement.style.display = "none";
            }, 3000);
        }
    } catch (e) {
        console.error("检查向量化进度失败", e);
    }
}

async function initializeApp() {
    try {
        const sendButton = document.getElementById("sendButton");
        sendButton.addEventListener("click", function () {
            chatWithAI();
        });

        const voiceButton = document.getElementById("voiceButton");
        if (voiceButton) {
            voiceButton.addEventListener("click", function () {
                toggleVoiceRecognition();
            });
        }

        const cameraButton = document.getElementById("cameraButton");
        if (cameraButton) {
            cameraButton.addEventListener("click", function () {
                toggleCamera();
            });
        }

        const avatarSelect = document.getElementById("avatarSelect");
        if (avatarSelect) {
            avatarSelect.addEventListener("change", function () {
                currentAvatar = avatarSelect.value || "lisa";
                const avatarImg = document.getElementById("avatarImage");
                if (avatarImg) {
                    avatarImg.setAttribute("data-avatar", currentAvatar);
                }
                updateAvatarExpression(lastEmotion);
            });
        }

        const chatInput = document.getElementById("chatInput");
        chatInput.addEventListener("keypress", function (event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                chatWithAI();
            }
        });

        chatInput.focus();

        const avatarImg = document.getElementById("avatarImage");
        if (avatarImg) {
            avatarImg.setAttribute("data-avatar", currentAvatar);
        }
    } catch (e) {
        console.error("初始化失败", e);
        alert("系统初始化失败，请刷新页面重试");
    }
}

// 更新情绪柱状图
function updateSentimentChart(probs) {
    const chart = document.getElementById("sentimentChart");
    if (!chart) return;

    for (const [emotion, prob] of Object.entries(probs)) {
        const item = chart.querySelector(`[data-emotion="${emotion}"]`);
        if (item) {
            const fill = item.querySelector(".bar-fill");
            const value = item.querySelector(".bar-value");
            const percentage = Math.round(prob * 100);
            
            if (fill) fill.style.height = `${percentage}%`;
            if (value) value.textContent = `${percentage}%`;
        }
    }
}

// 更新数字人表情
function updateAvatarExpression(emotion) {
    const avatarImg = document.getElementById("avatarImage");
    const loading = document.getElementById("avatarLoading");
    if (!avatarImg) return;

    lastEmotion = emotion || "default";

    const emotionMap = {
        "default": "default",
        "depressed": "depressed",
        "friendly": "friendly",
        "angry": "angry",
        "upbeat": "upbeat",
        "cheerful": "cheerful"
    };

    const fileKey = emotionMap[emotion] || "default";
    const newSrc = `/static/imgs/avatar/${fileKey}${AVATAR_FILE_EXT}`;

    const tempImg = new Image();
    tempImg.onload = () => {
        avatarImg.src = newSrc;
        avatarImg.style.opacity = "1";
        if (loading) loading.style.display = "none";
        avatarImg.setAttribute("data-avatar", currentAvatar);
    };
    tempImg.onerror = () => {
        console.warn(`未找到情绪图片: ${newSrc}，请确保该文件存在于 static/imgs/avatar/ 目录下`);
        avatarImg.src = "/static/imgs/avatar/default.png"; // 回退到默认
        if (loading) loading.textContent = "提示：请在 static/imgs/avatar/ 下放入对应图片";
    };
    
    avatarImg.style.opacity = "0.5"; // 切换时的过渡感
    tempImg.src = newSrc;
}

document.addEventListener("DOMContentLoaded", function () {
    initializeApp().catch(console.error);
});

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("当前浏览器不支持语音识别，请更换 Chrome 等浏览器。");
        return null;
    }
    const rec = new SpeechRecognition();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        let duration = 0;
        if (lastVoiceStartTime) {
            const diff = Date.now() - lastVoiceStartTime;
            duration = Math.max(1, Math.round(diff / 1000));
        } else {
            duration = 3;
        }
        sendToAI(transcript, "voice", duration);
    };
    rec.onerror = function (event) {
        console.error("语音识别错误:", event);
        alert("语音识别失败，请重试。");
    };
    rec.onend = function () {
        isRecognizing = false;
        const voiceButton = document.getElementById("voiceButton");
        if (voiceButton) {
            voiceButton.classList.remove("recording");
            voiceButton.textContent = "语音输入";
        }
        if (cameraVoiceEnabled) {
            startCameraVoiceLoop();
        }
    };
    return rec;
}

function toggleVoiceRecognition() {
    const voiceButton = document.getElementById("voiceButton");
    if (!recognition) {
        recognition = initSpeechRecognition();
        if (!recognition) return;
    }
    if (isRecognizing) {
        recognition.stop();
        isRecognizing = false;
        if (voiceButton) {
            voiceButton.classList.remove("recording");
            voiceButton.textContent = "语音输入";
        }
    } else {
        try {
            lastVoiceStartTime = Date.now();
            recognition.start();
            isRecognizing = true;
            if (voiceButton) {
                voiceButton.classList.add("recording");
                voiceButton.textContent = "正在聆听...";
            }
        } catch (e) {
            console.error("启动语音识别失败:", e);
            alert("无法启动语音识别，请检查浏览器权限设置。");
        }
    }
}

let cameraStream = null;

async function toggleCamera() {
    const video = document.getElementById("cameraVideo");
    const status = document.getElementById("cameraStatus");
    const button = document.getElementById("cameraButton");

    if (!video || !status || !button) return;

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
        video.srcObject = null;
        status.textContent = "摄像头已关闭";
        button.textContent = "开启摄像头";
        cameraVoiceEnabled = false;
        if (recognition && isRecognizing) {
            recognition.stop();
        }
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraStream = stream;
        video.srcObject = stream;
        status.textContent = "摄像头已开启（语音对话模式）";
        button.textContent = "关闭摄像头";
        cameraVoiceEnabled = true;
        
        startCameraVoiceLoop();
    } catch (e) {
        console.error("打开摄像头失败:", e);
        status.textContent = "摄像头打开失败，请检查浏览器权限";
    }
}

function startCameraVoiceLoop() {
    if (!cameraVoiceEnabled) return;
    if (!recognition) {
        recognition = initSpeechRecognition();
        if (!recognition) return;
    }
    if (isRecognizing) return;
    try {
        lastVoiceStartTime = Date.now();
        recognition.start();
        isRecognizing = true;
        const voiceButton = document.getElementById("voiceButton");
        if (voiceButton) {
            voiceButton.classList.add("recording");
            voiceButton.textContent = "正在聆听...";
        }
    } catch (e) {
        console.error("摄像头语音启动失败:", e);
    }
}
