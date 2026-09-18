/* =========================================================
   AI Assistive App — script.js
   Supports: object detection, text reading, scene description,
   navigation assistance. Bilingual: English / Arabic.
   ========================================================= */

const GEMINI_API_KEY =
    "YOUR_GEMINI_API_KEY_HERE";

let selectedModel    = null;
let currentLanguage  = localStorage.getItem("language") || null;
let lastResult       = "";
let recognition      = null;
let isListening      = false;
let isSpeaking       = false;
let isProcessing     = false;
let recognitionRestartTimer = null;


/* =========================================================
   Translations
   ========================================================= */

const translations = {

    en: {
        appTitle:             "AI Assistive App",
        objectDetection:      "Object<br>Detection",
        readText:             "Read Text",
        sceneDescription:     "Scene<br>Description",
        navigationAssist:     "Navigation<br>Assist",
        voiceCommand:         "Voice Command",
        objectDetectionTitle: "Object Detection",
        listening:            "Listening…",
        voiceStatus:          "Voice control active",
        ready:                "Ready. Ask me what you need.",
        cameraStarting:       "Starting camera…",
        cameraInactive:       "Camera is not active.",
        cameraError:          "Camera permission denied or unavailable.",
        microphoneError:      "Microphone permission denied or unavailable.",
        modelLoading:         "Preparing AI model…",
        modelUnavailable:     "AI model is unavailable.",
        scanning:             "Analysing what is in front of you…",
        detectionError:       "Could not process the image. Check your connection.",
        noResult:             "No previous result to repeat.",
        goingBack:            "Going back.",
        unknownCommand:       "Command not recognised.",
        openingDetection:     "Opening object detection.",
        openingReadText:      "Opening text reading.",
        openingScene:         "Opening scene description.",
        openingNavigation:    "Opening navigation assistance.",
        repeat:               "Repeating.",
        stopped:              "Voice control stopped.",
    },

    ar: {
        appTitle:             "التطبيق المساعد بالذكاء الاصطناعي",
        objectDetection:      "اكتشاف<br>الأشياء",
        readText:             "قراءة النص",
        sceneDescription:     "وصف<br>المشهد",
        navigationAssist:     "المساعدة في<br>التنقل",
        voiceCommand:         "الأوامر الصوتية",
        objectDetectionTitle: "اكتشاف الأشياء",
        listening:            "جارٍ الاستماع…",
        voiceStatus:          "التحكم الصوتي مفعّل",
        ready:                "جاهز. أخبرني بما تريد.",
        cameraStarting:       "جارٍ تشغيل الكاميرا…",
        cameraInactive:       "الكاميرا غير مفعّلة.",
        cameraError:          "تم رفض إذن الكاميرا أو أنها غير متاحة.",
        microphoneError:      "تم رفض إذن الميكروفون أو أن التعرف على الصوت غير متاح.",
        modelLoading:         "جارٍ تجهيز نموذج الذكاء الاصطناعي…",
        modelUnavailable:     "نموذج الذكاء الاصطناعي غير متاح.",
        scanning:             "جارٍ تحليل ما أمامك…",
        detectionError:       "تعذّرت معالجة الصورة. تحقق من الاتصال.",
        noResult:             "لا توجد نتيجة سابقة لإعادتها.",
        goingBack:            "جارٍ الرجوع.",
        unknownCommand:       "لم أفهم الأمر.",
        openingDetection:     "جارٍ فتح اكتشاف الأشياء.",
        openingReadText:      "جارٍ فتح قراءة النص.",
        openingScene:         "جارٍ فتح وصف المشهد.",
        openingNavigation:    "جارٍ فتح المساعدة في التنقل.",
        repeat:               "جارٍ إعادة النتيجة.",
        stopped:              "تم إيقاف التحكم الصوتي.",
    },
};


/* =========================================================
   Boot
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {

    /* — DOM references — */
    const languageScreen    = document.getElementById("languageScreen");
    const app               = document.getElementById("app");
    const webcam            = document.getElementById("webcam");
    const captureCanvas     = document.getElementById("captureCanvas");
    const resultOverlay     = document.getElementById("resultOverlay");
    const voiceCommandBar   = document.getElementById("voiceCommandBar");
    const objectDetectionBtn = document.getElementById("objectDetectionBtn");
    const readTextBtn       = document.getElementById("readTextBtn");
    const sceneBtn          = document.getElementById("sceneBtn");
    const navBtn            = document.getElementById("navBtn");

    const isHomePage      = !!app && !webcam;
    const isDetectionPage = !!webcam;


    /* -------------------------------------------------------
       Helpers
       ------------------------------------------------------- */

    const t = key =>
        translations[currentLanguage]?.[key] ?? key;

    const setStatus = text => {
        if (resultOverlay) resultOverlay.innerText = text;
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));


    /* -------------------------------------------------------
       Speech synthesis
       ------------------------------------------------------- */

    const getSpeechLang = () =>
        currentLanguage === "ar" ? "ar-SA" : "en-US";

    function speakText(text, restartListening = true) {
        return new Promise(resolve => {
            if (!text || !("speechSynthesis" in window)) {
                resolve();
                return;
            }

            isSpeaking = true;
            stopRecognition();
            window.speechSynthesis.cancel();

            const utt   = new SpeechSynthesisUtterance(text);
            utt.lang    = getSpeechLang();
            utt.rate    = currentLanguage === "ar" ? 0.88 : 0.9;
            utt.pitch   = 1;
            utt.volume  = 1;

            /*
             * Chrome / Android bug: speechSynthesis silently stops after ~15 s
             * on long utterances. Calling resume() every 10 s keeps it alive.
             */
            let keepAlive = null;

            const startKeepAlive = () => {
                keepAlive = setInterval(() => {
                    if (window.speechSynthesis.speaking) {
                        window.speechSynthesis.pause();
                        window.speechSynthesis.resume();
                    } else {
                        clearInterval(keepAlive);
                    }
                }, 10000);
            };

            const onDone = () => {
                clearInterval(keepAlive);
                isSpeaking = false;
                resolve();
                if (restartListening) scheduleRecognitionStart();
            };

            utt.onstart = startKeepAlive;
            utt.onend   = onDone;
            utt.onerror = onDone;

            window.speechSynthesis.speak(utt);
        });
    }


    /*
     * speakChunked — splits long text into sentence-sized pieces and speaks
     * them one after another. Prevents mobile browsers from silently
     * truncating utterances that exceed ~300 characters.
     */
    async function speakChunked(text, restartListeningAfter = true) {
        if (!text) return;

        // Split on Arabic/Latin sentence-ending punctuation while keeping the delimiter
        const chunks = text
            .split(/(?<=[.!?؟.\n])\s+/)
            .map(s => s.trim())
            .filter(Boolean);

        for (let i = 0; i < chunks.length; i++) {
            const isLast = i === chunks.length - 1;
            // Only restart listening after the very last chunk
            await speakText(chunks[i], isLast ? restartListeningAfter : false);
        }
    }


    /* -------------------------------------------------------
       Language / i18n
       ------------------------------------------------------- */

    function applyLanguage() {
        if (!currentLanguage || !translations[currentLanguage]) return;

        document.documentElement.lang = currentLanguage;
        document.documentElement.dir  = currentLanguage === "ar" ? "rtl" : "ltr";

        document.querySelectorAll("[data-i18n]").forEach(el => {
            const value = translations[currentLanguage][el.dataset.i18n];
            if (value) el.innerHTML = value;
        });
    }

    function showApp() {
        applyLanguage();
        if (languageScreen) languageScreen.style.display = "none";
        if (app)            app.style.display = "flex";
    }

    async function selectLanguage(lang) {
        if (!translations[lang]) return;
        currentLanguage = lang;
        localStorage.setItem("language", lang);
        showApp();

        const welcomeMsg = lang === "ar"
            ? "مرحبًا بك. التحكم الصوتي جاهز."
            : "Welcome. Voice control is ready.";

        await speakText(welcomeMsg, false);
        await sleep(300);
        startVoiceRecognition();
    }

    document.querySelectorAll(".language-btn").forEach(btn => {
        btn.addEventListener("click", () => selectLanguage(btn.dataset.language));
    });

    if (!currentLanguage) {
        if (app) app.style.display = "none";
        return;
    }

    showApp();


    /* -------------------------------------------------------
       Speech recognition
       ------------------------------------------------------- */

    const getRecognitionLang = () =>
        currentLanguage === "ar" ? "ar-SA" : "en-US";

    function createRecognition() {
        const Recognition =
            window.SpeechRecognition || window.webkitSpeechRecognition || null;

        if (!Recognition) {
            console.error("SpeechRecognition not supported.");
            return null;
        }

        const inst          = new Recognition();
        inst.continuous     = false;
        inst.interimResults = false;
        inst.maxAlternatives = 5;
        inst.lang           = getRecognitionLang();

        inst.onstart = () => {
            isListening = true;
            if (isDetectionPage) setStatus(t("listening"));
        };

        inst.onresult = event => {
            const result     = event.results?.[event.resultIndex]?.[0];
            const transcript = result?.transcript?.trim();
            if (transcript) {
                console.log("Voice:", transcript);
                handleVoiceCommand(transcript);
            }
        };

        inst.onerror = event => {
            console.warn("Recognition error:", event.error);
            isListening = false;

            if (["not-allowed", "service-not-allowed"].includes(event.error)) {
                if (isDetectionPage) setStatus(t("microphoneError"));
                return;
            }
            if (["aborted", "audio-capture"].includes(event.error)) return;

            scheduleRecognitionStart();
        };

        inst.onend = () => {
            isListening = false;
            if (!isSpeaking && !isProcessing) scheduleRecognitionStart();
        };

        return inst;
    }

    function startVoiceRecognition() {
        if (!currentLanguage || isSpeaking || isProcessing || isListening) return;

        if (!recognition) recognition = createRecognition();

        if (!recognition) {
            if (isDetectionPage) setStatus(t("microphoneError"));
            return;
        }

        recognition.lang = getRecognitionLang();

        try {
            recognition.start();
        } catch (err) {
            console.warn("Recognition start:", err);
            scheduleRecognitionStart();
        }
    }

    function stopRecognition() {
        clearTimeout(recognitionRestartTimer);
        if (!recognition) return;
        try { recognition.stop(); } catch (err) { console.warn("Recognition stop:", err); }
        isListening = false;
    }

    function scheduleRecognitionStart() {
        clearTimeout(recognitionRestartTimer);
        if (isSpeaking || isProcessing || !currentLanguage) return;
        recognitionRestartTimer = setTimeout(startVoiceRecognition, 600);
    }


    /* -------------------------------------------------------
       Command normalisation
       ------------------------------------------------------- */

    function normalizeArabic(text) {
        return text
            .toLowerCase()
            .replace(/[ًٌٍَُِّْـ]/g, "")
            .replace(/[إأآا]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ة/g, "ه")
            .replace(/ؤ/g, "و")
            .replace(/ئ/g, "ي");
    }

    function normalizeCommand(text) {
        let v = text
            .toLowerCase()
            .trim()
            .replace(/[؟?!.,،؛:]/g, " ")
            .replace(/\s+/g, " ");
        return currentLanguage === "ar" ? normalizeArabic(v) : v;
    }

    function containsAny(text, words) {
        return words.some(w =>
            text.includes(currentLanguage === "ar" ? normalizeArabic(w) : w)
        );
    }

    function isVisualQuestion(cmd) {
        if (currentLanguage === "ar") {
            const visualWords   = ["ماذا","ما","شنو","موجود","يوجد","ترى","شايف","اشوف","تشوف","صف","وصف","شيء","شي","حاجه","حاجة"];
            const locationWords = ["امامي","قدامي","قدامى","الامام","امام","حولي","حولى","اليمين","يمين","اليسار","يسار","الشمال","شمال"];
            const phrases       = [
                "شنو شايف","ماذا ترى","ماذا يوجد","ما يوجد","ما الموجود",
                "ماذا امامي","ماذا امام","ماذا قدامي","ما امامي","ما قدامي",
                "شنو قدامي","شنو امامي","شنو في قدامي","شنو في امامي",
                "شنو الموجود قدامي","شنو الموجود امامي","ماذا يوجد امامي",
                "ماذا يوجد امام","ماذا يوجد حولي","صف لي ما امامي",
                "صف لي ماذا امامي","صف ما امامي","صف الموجود امامي",
                "ما الذي امامي","ما الذي يوجد امامي","هل يوجد شيء امامي",
                "هل يوجد شيء قدامي",
            ];
            return (containsAny(cmd, visualWords) && containsAny(cmd, locationWords))
                || containsAny(cmd, phrases);
        }

        return containsAny(cmd, [
            "what is in front of me","what's in front of me",
            "what is ahead of me","what's ahead of me",
            "what do you see","what can you see",
            "what is there","what's there",
            "what is around me","what's around me",
            "describe what is in front of me",
            "describe what you see",
            "tell me what is in front of me",
        ]);
    }

    function getDirection(cmd) {
        const right = currentLanguage === "ar"
            ? ["اليمين","يمين","على اليمين","في اليمين"]
            : ["right","on the right"];
        const left  = currentLanguage === "ar"
            ? ["اليسار","يسار","على اليسار","في اليسار","الشمال","شمال"]
            : ["left","on the left"];

        if (containsAny(cmd, right)) return "right";
        if (containsAny(cmd, left))  return "left";
        return "general";
    }


    /* -------------------------------------------------------
       Voice command dispatcher
       ------------------------------------------------------- */

    async function handleVoiceCommand(raw) {
        const cmd = normalizeCommand(raw);
        if (!cmd) return;

        stopRecognition();

        /* Stop listening */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["اسكت","توقف","قف","توقف عن الاستماع"]
                : ["stop","be quiet","quiet","stop listening"]
        )) {
            await speakText(t("stopped"), false);
            return;
        }

        /* Repeat last result */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["كرر","اعد","اعيد","مرة اخرى","مره اخرى","مرة تانية","مره تانيه"]
                : ["repeat","say that again","say it again"]
        )) {
            await speakText(lastResult || t("noResult"));
            return;
        }

        /* Go back / home */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["رجوع","ارجع","الرجوع","الصفحة الرئيسية","الرئيسية","ارجع للرئيسية"]
                : ["back","go back","home","go home","main page"]
        )) {
            await speakText(t("goingBack"), false);
            if (isDetectionPage) { stopCamera(); window.location.href = "index.html"; }
            else { scheduleRecognitionStart(); }
            return;
        }

        /* Visual / "what's in front of me" */
        if (isVisualQuestion(cmd)) {
            if (isHomePage) {
                await speakText(t("openingDetection"), false);
                window.location.href = "object-detection.html";
            } else if (isDetectionPage) {
                await analyzeCamera(getDirection(cmd));
            }
            return;
        }

        /* Object detection */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["اكتشاف الاشياء","اكتشف الاشياء","اكتشاف","كشف الاشياء","كشف"]
                : ["object detection","detect objects","detect"]
        )) {
            if (isHomePage) { await speakText(t("openingDetection"), false); window.location.href = "object-detection.html"; }
            else if (isDetectionPage) { await analyzeCamera("general"); }
            return;
        }

        /* Read text */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["اقرا النص","اقرا الكلام","قراءه النص","قراءة النص","اقرا لي","اقرا ما هو مكتوب","ماذا مكتوب","ما المكتوب"]
                : ["read text","read the text","read this","read it","what does it say","read the writing"]
        )) {
            if (isHomePage) { await speakText(t("openingReadText"), false); window.location.href = "read-text.html"; }
            else if (isDetectionPage) { await analyzeCamera("text"); }
            return;
        }

        /* Scene description */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["صف المكان","صف لي المكان","اوصف المكان","اوصف لي المكان","وصف المكان","صف المشهد","وصف المشهد","ما شكل المكان"]
                : ["describe the scene","describe the place","describe this place","scene description","what does the place look like"]
        )) {
            if (isHomePage) { await speakText(t("openingScene"), false); window.location.href = "scene-description.html"; }
            else if (isDetectionPage) { await analyzeCamera("scene"); }
            return;
        }

        /* Navigation */
        if (containsAny(cmd,
            currentLanguage === "ar"
                ? ["المساعدة في التنقل","ساعدني في التنقل","التنقل","مساعدة التنقل","ساعدني على التنقل"]
                : ["navigation","navigation assist","help me navigate","navigation assistance"]
        )) {
            if (isHomePage) { await speakText(t("openingNavigation"), false); window.location.href = "navigation.html"; }
            else if (isDetectionPage) { await analyzeCamera("navigation"); }
            return;
        }

        await speakText(t("unknownCommand"));
    }


    /* -------------------------------------------------------
       Gemini — model selection
       ------------------------------------------------------- */

    async function fetchAvailableModels() {
        if (selectedModel) return selectedModel;

        const PREFERRED = [
  //  "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
];

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`
            );
            if (!res.ok) throw new Error(`Model list failed: ${res.status}`);

            const { models = [] } = await res.json();
            const supportsContent = m => m.supportedGenerationMethods?.includes("generateContent");

            for (const id of PREFERRED) {
                const found = models.find(m => m.name === `models/${id}` && supportsContent(m));
                if (found) {
                    selectedModel = found.name.replace("models/", "");
                    return selectedModel;
                }
            }

            const fallback = models.find(supportsContent);
            if (fallback) {
                selectedModel = fallback.name.replace("models/", "");
                return selectedModel;
            }

            return null;
        } catch (err) {
            console.error("Gemini model error:", err);
            return null;
        }
    }


    /* -------------------------------------------------------
       Camera
       ------------------------------------------------------- */

    async function startCamera() {
        if (!webcam) return false;

        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus(t("cameraError"));
            await speakText(t("cameraError"));
            return false;
        }

        try {
            setStatus(t("cameraStarting"));

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });

            webcam.srcObject = stream;
            await webcam.play();
            await waitForVideo();
            return true;
        } catch (err) {
            console.error("Camera error:", err);
            setStatus(t("cameraError"));
            await speakText(t("cameraError"));
            return false;
        }
    }

    function waitForVideo() {
        return new Promise(resolve => {
            if (webcam.videoWidth > 0) { resolve(); return; }
            const timeout = setTimeout(resolve, 3000);
            webcam.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
        });
    }

    function stopCamera() {
        webcam?.srcObject?.getTracks().forEach(t => t.stop());
        if (webcam) webcam.srcObject = null;
    }


    /* -------------------------------------------------------
       Frame capture
       ------------------------------------------------------- */

    function captureFrame() {
        if (!webcam || !captureCanvas || !webcam.videoWidth) return null;

        const maxW   = 1280;
        let w        = webcam.videoWidth;
        let h        = webcam.videoHeight;

        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }

        captureCanvas.width  = w;
        captureCanvas.height = h;

        const ctx = captureCanvas.getContext("2d");
        if (!ctx) return null;

        ctx.drawImage(webcam, 0, 0, w, h);
        return captureCanvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    }


    /* -------------------------------------------------------
       Gemini Vision — prompts
       ------------------------------------------------------- */

    function buildPrompt(mode) {
        const ar = currentLanguage === "ar";

        const tasks = {

            /* ---- General / "what's in front of me" ---- */
            general: ar ? `\
أنت مساعد بصري لشخص كفيف يحتاج وصفاً دقيقاً ومفيداً لما أمامه.

افعل ما يلي بالترتيب:
1. إذا كان هناك خطر فوري (درج، حافة، سيارة، شخص قريب جداً، عائق على الأرض) — اذكره أولاً وبوضوح.
2. صف المكان العام: هل هو غرفة داخلية؟ شارع؟ ممر؟ محل؟ مكتب؟
3. اذكر الأشياء الرئيسية مع موقعها: يمين، يسار، وسط، قريب، بعيد، أمام مباشرة.
4. اذكر الأشخاص إن وُجدوا وموقعهم وما يفعلونه إن كان واضحاً.
5. اذكر أي نص أو لافتة مرئية بوضوح.
6. اذكر تفاصيل مفيدة: إضاءة المكان، ازدحام، مساحة فارغة للمشي.

لا تقل "لا توجد مخاطر" أو "المشهد آمن" — فقط صف ما تراه بإيجاب.
إذا كانت الصورة مظلمة أو ضبابية — قل ذلك في جملة واحدة وتوقف.` : `\
You are a visual assistant for a blind person who needs an accurate, useful description of their surroundings.

Do the following in order:
1. If there is an immediate hazard (stairs, ledge, moving vehicle, person very close, obstacle on the ground) — state it first and clearly.
2. Describe the general environment: indoors or outdoors? A room, corridor, street, shop, office?
3. Name the main objects with their position: left, right, centre, near, far, straight ahead.
4. Mention any people — their position and what they appear to be doing if clear.
5. Read any clearly visible text or signs.
6. Add useful context: lighting, how crowded it is, clear walking space.

Do NOT say "no hazards detected" or "the scene is safe" — just describe what you see.
If the image is too dark or blurry — say so in one sentence and stop.`,

            /* ---- Right side ---- */
            right: ar ? `\
أنت مساعد بصري لشخص كفيف.
ركّز تماماً على الجانب الأيمن من الصورة.

اذكر:
- أي خطر فوري على اليمين (عائق، حافة، شخص قريب).
- الأشياء الموجودة على اليمين من الأقرب إلى الأبعد.
- المسافة التقريبية لكل شيء: قريب جداً، قريب، متوسط، بعيد.
- أي نص أو لافتة على اليمين.
إذا كانت الجهة اليمنى فارغة أو واضحة — قل ذلك بوضوح.` : `\
You are a visual assistant for a blind person.
Focus entirely on the RIGHT side of the image.

Report:
- Any immediate hazard on the right (obstacle, ledge, person very close).
- Objects on the right from nearest to furthest.
- Approximate distance for each: very close, close, mid-range, far.
- Any text or signs on the right.
If the right side is clear and open — state that clearly.`,

            /* ---- Left side ---- */
            left: ar ? `\
أنت مساعد بصري لشخص كفيف.
ركّز تماماً على الجانب الأيسر من الصورة.

اذكر:
- أي خطر فوري على اليسار (عائق، حافة، شخص قريب).
- الأشياء الموجودة على اليسار من الأقرب إلى الأبعد.
- المسافة التقريبية لكل شيء: قريب جداً، قريب، متوسط، بعيد.
- أي نص أو لافتة على اليسار.
إذا كانت الجهة اليسرى فارغة أو واضحة — قل ذلك بوضوح.` : `\
You are a visual assistant for a blind person.
Focus entirely on the LEFT side of the image.

Report:
- Any immediate hazard on the left (obstacle, ledge, person very close).
- Objects on the left from nearest to furthest.
- Approximate distance for each: very close, close, mid-range, far.
- Any text or signs on the left.
If the left side is clear and open — state that clearly.`,

            /* ---- Read text ---- */
            text: ar ? `\
أنت مساعد بصري لشخص كفيف يريد معرفة ما هو مكتوب أمامه.

اقرأ كل النصوص الظاهرة بوضوح في الصورة:
- ابدأ بالنص الأكبر أو الأبرز.
- اقرأ اللافتات، العناوين، الأسماء، الأرقام، والتعليمات.
- إذا كان هناك أكثر من نص، اذكر موقع كل منها (أعلى، وسط، يمين...).
- إذا كان النص عربياً اقرأه كاملاً. إذا كان بلغة أخرى، اذكر اللغة وترجمه إن أمكن.
- لا تخمّن الكلمات غير الواضحة — قل "كلمة غير واضحة" إذا لزم.
إذا لم يكن هناك نص مرئي — قل ذلك بوضوح.` : `\
You are a visual assistant for a blind person who wants to know what is written in front of them.

Read all clearly visible text in the image:
- Start with the largest or most prominent text.
- Read signs, titles, names, numbers, and instructions.
- If there are multiple texts, state the position of each (top, centre, right…).
- If text is in another language, name the language and translate it if possible.
- Do not guess unclear words — say "unclear word" if needed.
If there is no visible text — say so clearly.`,

            /* ---- Scene description ---- */
            scene: ar ? `\
أنت مساعد بصري لشخص كفيف يريد فهم المكان الذي يوجد فيه.

قدّم وصفاً شاملاً ومرتباً:
1. نوع المكان: غرفة، شارع، مبنى، حديقة، محل، إلخ.
2. الحجم والاتساع: هل هو مكان ضيق أم واسع؟
3. الأثاث والعناصر الرئيسية مع مواقعها.
4. الألوان السائدة والإضاءة.
5. الأشخاص: عددهم، مواقعهم، ما يفعلونه.
6. الأبواب والنوافذ والمداخل والمخارج.
7. أي تفاصيل بيئية مميزة: نباتات، لوحات، أجهزة، إلخ.
اجعل الوصف كأنك ترسم صورة كاملة بالكلمات لشخص لم ير المكان قط.` : `\
You are a visual assistant for a blind person who wants to understand the space they are in.

Provide a thorough, ordered description:
1. Type of place: room, street, building, park, shop, etc.
2. Size and openness: is it cramped or spacious?
3. Main furniture or elements with their positions.
4. Dominant colours and lighting conditions.
5. People: how many, where they are, what they appear to be doing.
6. Doors, windows, entrances, and exits.
7. Any distinctive environmental details: plants, artwork, equipment, etc.
Paint a complete picture in words for someone who has never seen this place.`,

            /* ---- Navigation ---- */
            navigation: ar ? `\
أنت مساعد ملاحة لشخص كفيف يحتاج إرشادات دقيقة للتنقل الآمن.

أولاً — الأخطار الفورية (أهم شيء):
- درج صاعد أو نازل في المسار المباشر.
- حافة، منحدر، أو حفرة.
- عائق على الأرض: صندوق، كابل، حقيبة، إلخ.
- شخص أو مركبة في المسار.
- باب مفتوح للداخل أو الخارج.

ثانياً — المسار الآمن:
- هل الطريق أمامه مباشرة مفتوح؟
- إلى أين يمكنه التحرك بأمان؟ (يمين، يسار، أمام، توقف)
- هل هناك جدار أو حاجز يمكن اتباعه؟

ثالثاً — السياق المساعد:
- نوع الأرضية: بلاط، إسفلت، سجادة، رمل، إلخ.
- مستوى الازدحام من حوله.
- أي معالم يمكنه الاستدلال بها.

إذا كان المسار واضحاً تماماً — قل ذلك وأعطِ التوجيه المناسب.` : `\
You are a navigation assistant for a blind person who needs precise guidance to move safely.

FIRST — Immediate hazards (most critical):
- Stairs going up or down in the direct path.
- Ledge, ramp, or hole.
- Obstacle on the ground: box, cable, bag, etc.
- Person or vehicle in the path.
- Door opening inward or outward.

SECOND — Safe path:
- Is the way directly ahead open?
- Where can they move safely? (right, left, ahead, stop)
- Is there a wall or railing they can follow?

THIRD — Helpful context:
- Floor type: tile, asphalt, carpet, sand, etc.
- Crowd level around them.
- Any landmarks they can use for orientation.

If the path is completely clear — say so and give appropriate movement guidance.`,

        };

        const task = tasks[mode] ?? tasks.general;

        /* Language instruction */
        const langInstruction = ar
            ? "أجب بالعربية الفصحى الواضحة والبسيطة. استخدم جملاً قصيرة ومباشرة. لا عامية."
            : "Respond in clear, simple English. Use short, direct sentences.";

        /* Shared rules */
        const rules = ar ? `\
قواعد يجب اتباعها دائماً:
- لا تذكر أنك ذكاء اصطناعي أو أنك تحلل صورة.
- لا تخترع أو تخمّن ما لا تراه بوضوح.
- لا تقل "لا توجد مخاطر" أو "المشهد آمن" — فقط صف ما هو موجود فعلاً.
- استخدم مصطلحات الموقع دائماً: يمين، يسار، وسط، قريب، بعيد، أمام، خلف.
- اكتب وصفاً كاملاً وافياً — لا تختصر ولا تتوقف في منتصف الوصف.
- إذا كان هناك الكثير لتصفه، رتّبه من الأهم إلى الأقل أهمية.` : `\
Rules to always follow:
- Never say you are an AI or that you are analysing an image.
- Never invent or guess what you cannot clearly see.
- Never say "no hazards" or "scene is safe" — just describe what is actually there.
- Always use position terms: left, right, centre, near, far, ahead, behind.
- Write a full and complete description — do not cut short or stop mid-description.
- If there is a lot to describe, order from most important to least.`;

        return `${task}\n\n${langInstruction}\n\n${rules}`;
    }


    /* -------------------------------------------------------
       Gemini Vision — main analysis
       ------------------------------------------------------- */

    async function analyzeCamera(mode = "general") {
        if (!webcam?.srcObject) {
            await speakText(t("cameraInactive"));
            return;
        }
        if (isProcessing) return;

        isProcessing = true;
        stopRecognition();
        setStatus(t("scanning"));

        const model = await fetchAvailableModels();
        if (!model) {
            isProcessing = false;
            setStatus(t("modelUnavailable"));
            await speakText(t("modelUnavailable"));
            return;
        }

        const base64Image = captureFrame();
        if (!base64Image) {
            isProcessing = false;
            setStatus(t("cameraInactive"));
            await speakText(t("cameraInactive"));
            return;
        }

        const endpoint =
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: buildPrompt(mode) },
                            { inline_data: { mime_type: "image/jpeg", data: base64Image } },
                        ],
                    }],
                    generationConfig: {
                        temperature:     0.3,
                        maxOutputTokens: 600,
                    },
                }),
            });

            if (!res.ok) {
                const msg = await res.text();
                throw new Error(`Gemini ${res.status}: ${msg}`);
            }

            const data = await res.json();
            const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (!textResult) throw new Error("Empty Gemini response.");

            lastResult = textResult;
            setStatus(textResult);
            isProcessing = false;

            /*
             * Some browsers (especially mobile WebKit) truncate utterances
             * longer than ~300 chars. Split on sentence boundaries and speak
             * each chunk in sequence so nothing gets cut off.
             */
            await speakChunked(textResult);

        } catch (err) {
            console.error("Gemini Vision error:", err);
            isProcessing = false;
            setStatus(t("detectionError"));
            await speakText(t("detectionError"));
        }
    }


    /* -------------------------------------------------------
       Home page buttons
       ------------------------------------------------------- */

    objectDetectionBtn?.addEventListener("click", () => stopRecognition());

    readTextBtn?.addEventListener("click", e => {
        e.preventDefault();
        stopRecognition();
        window.location.href = "read-text.html";
    });

    sceneBtn?.addEventListener("click", e => {
        e.preventDefault();
        stopRecognition();
        window.location.href = "scene-description.html";
    });

    navBtn?.addEventListener("click", e => {
        e.preventDefault();
        stopRecognition();
        window.location.href = "navigation.html";
    });

    if (voiceCommandBar) voiceCommandBar.style.cursor = "default";


    /* -------------------------------------------------------
       Page startup
       ------------------------------------------------------- */

    if (isDetectionPage) {
        const cameraReady = await startCamera();
        if (!cameraReady) return;
        await sleep(500);
        await speakText(t("ready"));
    }

    if (isHomePage) {
        await sleep(700);
        startVoiceRecognition();
    }

});
