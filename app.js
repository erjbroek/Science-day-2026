// const MODEL_PATH = "./model-tfjs/model.json";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const clearButton =document.getElementById("clearButton");
const statusElement =document.getElementById("status");
const predictionsElement = document.getElementById("predictions");




// testing

const MODEL_PATH = "./model-tfjs/model.json";

console.log("Current page:", window.location.href);
console.log("Model path:", MODEL_PATH);
console.log(
    "Resolved model URL:",
    new URL(MODEL_PATH, window.location.href).href
);

model = await tf.loadLayersModel(MODEL_PATH);



// testing

let model = null;
let isDrawing = false;
let hasDrawing = false;
let currentImageIndex = null;

let CLASSES = [];
let CLASSES_NL = [];
let CLASSES_EN = [];

async function loadClasses() {
    const [nlResponse, enResponse] = await Promise.all([
        fetch("./class_names.txt"),
        fetch("./class_names_en.txt")
    ]);

    if (!nlResponse.ok || !enResponse.ok) {
        throw new Error("Could not load class name files.");
    }

    const [nlText, enText] = await Promise.all([
        nlResponse.text(),
        enResponse.text()
    ]);

    const parseClasses = text =>
        text.split(/\r?\n/)
            .map(name => name.trim())
            .filter(Boolean);

    CLASSES_NL = parseClasses(nlText);
    CLASSES_EN = parseClasses(enText);

    const response = await fetch("./class_names.txt");
    console.log(response)

    if (!response.ok) {
        throw new Error(
            `Could not load class_names.txt: ${response.status}`
        );
    }

    const text = await response.text();

    CLASSES = text
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(name => name.length > 0);

    if (CLASSES_NL.length !== CLASSES_EN.length) {
        throw new Error("The Dutch and English class files have different lengths.");
    }

    console.log(`Loaded ${CLASSES_NL.length} classes.`);
}

function clearCanvas() {
    ctx.fillStyle = "white";
    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    hasDrawing = false;

    predictionsElement.innerHTML = "";

    predictionImage.hidden = true;
    predictionImage.src = "";
    currentImageIndex = null;
}

function getPointerPosition(event) {
    const rect =canvas.getBoundingClientRect();
    const scaleX =canvas.width / rect.width;
    const scaleY =canvas.height / rect.height;

    return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
    };
}

function startDrawing(event) {
    event.preventDefault();
    isDrawing = true;
    hasDrawing = true;

    const point =
        getPointerPosition(event);

    ctx.beginPath();

    ctx.moveTo(
        point.x,
        point.y
    );
}

function draw(event) {
    if (!isDrawing) {
        return;
    }

    event.preventDefault();

    const point = getPointerPosition(event);

    ctx.strokeStyle =
        drawingMode === "draw" ? "#000000" : "#ffffff";

    ctx.lineWidth =
        drawingMode === "draw" ? 12 : 24;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.lineTo(point.x, point.y);
    ctx.stroke();
}

function stopDrawing(event) {

    if (!isDrawing) {
        return;
    }

    event.preventDefault();
    isDrawing = false;
    ctx.closePath();
}

function configureCanvas() {
    ctx.fillStyle = "white";
    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.strokeStyle = "black";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
}

function canvasToTensor() {

    return tf.tidy(() => {

        const resizedCanvas = document.createElement("canvas");

        resizedCanvas.width = 28;
        resizedCanvas.height = 28;

        const resizedContext =
            resizedCanvas.getContext("2d");

        resizedContext.fillStyle = "white";

        resizedContext.fillRect(
            0,
            0,
            28,
            28
        );

        resizedContext.drawImage(
            canvas,
            0,
            0,
            28,
            28
        );

        let tensor =
            tf.browser.fromPixels(
                resizedCanvas,
                1
            );

        tensor =
            tensor.toFloat().div(255);

        tensor =
            tf.sub(
                1,
                tensor
            );

        tensor = tensor.expandDims(0);

        return tensor;
    });
}


const predictionImage = document.getElementById("predictionImage");

function showPredictionImage(index) {
    // Same prediction as the image currently being shown.
    // Don't reload the image.
    if (index === currentImageIndex) {
        return;
    }

    currentImageIndex = index;

    const englishName = CLASSES_EN[index];

    if (!englishName) {
        predictionImage.hidden = true;
        return;
    }

    const filename = englishName
        .toLowerCase()
        .trim()
        .replaceAll(" ", "_") + ".jpg";

    const imagePath = `../images/${filename}`;

    predictionImage.hidden = true;
    predictionImage.src = imagePath;
    predictionImage.alt = englishName;

    predictionImage.onload = () => {
        predictionImage.hidden = false;
    };

    predictionImage.onerror = () => {
        predictionImage.hidden = true;
        console.error(`Image not found: ${imagePath}`);
    };
}

async function predict() {

    if (!model) {

        statusElement.textContent =
            "Model has not loaded yet.";

        return;
    }

    if (!hasDrawing) {

        statusElement.textContent =
            "Draw something first.";

        return;
    }

    try {

        const input =
            canvasToTensor();

        const output =
            model.predict(input);

        const probabilities =
            await output.data();

        input.dispose();
        output.dispose();
        showPredictions(probabilities);

        statusElement.textContent =
            "Prediction complete.";

    } catch (error) {

        console.error(error);

        statusElement.textContent =
            "Prediction failed. Check the browser console.";

    }
}

function showPredictions(probabilities) {

    const EXCLUDED_CLASSES = new Set([
        "regen",
        "slaapzak",
        "knie",
        "been",
        "flessendop",
        "diermigratie",
        "tang",
        "hechtingen",
        "wijnfles",
        "hechtingen",
        "vliegdekschip",
        "The_Great_Wall_of_China",
        "plafondventilator",
        "spreadsheet",
        "vloerlamp",
        "gewicht",
        "knife",
        "yoga",
        "pistool",
        "rifle",
        "stereo",
        "bottlecap",
        "flessendop",
        "bosje",
        "bush"
        
    ]);

    const results = [];

    for (
        let i = 0;
        i < probabilities.length;
        i++
    ) {
        const label = CLASSES[i];

        if (EXCLUDED_CLASSES.has(label)) {
            continue;
        }

        results.push({
            index: i,
            probability: probabilities[i],
            label: label
        });
    }

    results.sort(
        (a, b) =>
            b.probability -
            a.probability
    );


    if (results.length > 0) {
        showPredictionImage(results[0].index);
    }

    const topResults =
        results.slice(0, 5);

    predictionsElement.innerHTML = "";

    for (const result of topResults) {

        const percentage =
            result.probability * 100;

        const row =
            document.createElement("div");

        row.className =
            "prediction";

        const label =
            document.createElement("div");

        label.className =
            "prediction-label";

        label.textContent =
            result.label;

        const barContainer =
            document.createElement("div");

        barContainer.className =
            "prediction-bar-container";

        const bar =
            document.createElement("div");

        bar.className =
            "prediction-bar";

        bar.style.width =
            `${percentage}%`;

        barContainer.appendChild(bar);

        const percent =
            document.createElement("div");

        percent.className =
            "prediction-percent";

        percent.textContent =
            `${percentage.toFixed(1)}%`;

        row.appendChild(label);

        row.appendChild(barContainer);

        row.appendChild(percent);

        predictionsElement.appendChild(row);
    }
}

let predictionTimer = null;
const drawButton = document.getElementById("drawButton");
const eraseButton = document.getElementById("eraseButton");

function setDrawingMode(mode) {
    drawingMode = mode;

    drawButton.classList.toggle("active", mode === "draw");
    eraseButton.classList.toggle("active", mode === "erase");
}

drawButton.addEventListener("click", () => {
    setDrawingMode("draw");
});

eraseButton.addEventListener("click", () => {
    setDrawingMode("erase");
});


let drawingMode = "draw";

function startPredictionLoop() {
    if (predictionTimer !== null) return;

    predictionTimer = setInterval(() => {
        if (hasDrawing && model) {
            console.log('drawing something')
            predict();
        }
    }, 200);
}

function stopPredictionLoop() {
    if (predictionTimer !== null) {
        clearInterval(predictionTimer);
        predictionTimer = null;
    }
}


async function loadModel() {

    try {

        statusElement.textContent =
            "Loading DoodleNet...";

        console.log(
            "TensorFlow.js version:",
            tf.version.tfjs
        );

        console.log(
            "Loading:",
            MODEL_PATH
        );

        model =
            await tf.loadLayersModel(
                MODEL_PATH
            );

        console.log(
            "Model loaded:"
        );

        model.summary();

        console.log(
            "Input shape:",
            model.inputs[0].shape
        );

        console.log(
            "Output shape:",
            model.outputs[0].shape
        );

        statusElement.textContent =
            "DoodleNet loaded.";

    } catch (error) {

        console.error(
            "Could not load DoodleNet:",
            error
        );

        statusElement.textContent =
            "Could not load model. Check the console.";
    }
}


// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

canvas.addEventListener(
    "pointerdown",
    startDrawing
);

canvas.addEventListener(
    "pointermove",
    draw
);

canvas.addEventListener(
    "pointerup",
    stopDrawing
);

canvas.addEventListener(
    "pointercancel",
    stopDrawing
);

canvas.addEventListener(
    "pointerleave",
    stopDrawing
);

clearButton.addEventListener(
    "click",
    clearCanvas
);


async function start() {

    try {

        configureCanvas();

        await loadClasses();

        await loadModel();

        startPredictionLoop();

        console.log(
            "DoodleNet application ready."
        );

    } catch (error) {

        console.error(
            "Application initialization failed:",
            error
        );

        statusElement.textContent =
            "Failed to load DoodleNet. " +
            "Check the browser console.";
    }
}


start();