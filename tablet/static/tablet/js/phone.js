/**
 * Phone: 16:9 board with pen/eraser/move/select, per-board history, and image objects.
 */
(function () {
    'use strict';

    const WORLD_W = 1920;
    const WORLD_H = 1080;
    const NUM_BOARDS = 10;
    const TOOLBAR_H = 52;
    const ERASER_MIN_SIZE = 12;
    const HANDLE_SIZE_WORLD = 22;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const colorPicker = document.getElementById('colorPicker');
    const sizeSlider = document.getElementById('sizeSlider');
    const penBtn = document.getElementById('penBtn');
    const eraserBtn = document.getElementById('eraserBtn');
    const moveBtn = document.getElementById('moveBtn');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const clearBoardBtn = document.getElementById('clearBoardBtn');
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    const resetCamBtn = document.getElementById('resetCamBtn');
    const prevBoardBtn = document.getElementById('prevBoardBtn');
    const nextBoardBtn = document.getElementById('nextBoardBtn');
    const boardLabel = document.getElementById('boardLabel');
    const selectBtn = document.getElementById('selectBtn');
    const addImageBtn = document.getElementById('addImageBtn');
    const imageInput = document.getElementById('imageInput');

    let camX = WORLD_W / 2;
    let camY = WORLD_H / 2;
    let zoom = 1;

    let contentWidth = 1;
    let contentHeight = 1;
    let contentLeft = 0;
    let contentTop = 0;

    let tool = 'pen';
    let color = '#000000';
    let size = 4;

    let isDrawing = false;
    let activePointerId = null;
    let activeStrokeId = null;
    let lastSentWorld = null;
    let lastSentTime = 0;
    let lastPreviewScreenX = -1;
    let lastPreviewScreenY = -1;
    const SEND_THROTTLE_MS = 1000 / 60;

    let panStartScreenX = 0;
    let panStartScreenY = 0;
    let camStartX = 0;
    let camStartY = 0;

    let currentBoard = 0;
    const strokesByBoard = [];
    const currentStrokeByBoard = [];
    const imagesByBoard = [];
    const historyByBoard = [];
    const redoByBoard = [];
    const cameraByBoard = [];

    const imageCache = new Map();

    let selectedImageIdByBoard = [];
    let imageEditMode = null; // null | move | resize-se
    let imageEditStartWorld = null;
    let imageEditStartRect = null;

    for (let i = 0; i < NUM_BOARDS; i++) {
        strokesByBoard.push([]);
        currentStrokeByBoard.push(null);
        imagesByBoard.push([]);
        historyByBoard.push([]);
        redoByBoard.push([]);
        cameraByBoard.push({ camX: WORLD_W / 2, camY: WORLD_H / 2, zoom: 1 });
        selectedImageIdByBoard.push(null);
    }

    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsScheme + '//' + window.location.host + '/ws/draw/';
    let socket = null;

    function deepClone(v) {
        return JSON.parse(JSON.stringify(v));
    }

    function genId(prefix) {
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function getBoardIndex(raw) {
        return Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(raw, 10) || 0));
    }

    function findImage(board, id) {
        const images = imagesByBoard[board];
        for (let i = 0; i < images.length; i++) {
            if (images[i].id === id) return images[i];
        }
        return null;
    }

    function removeImageById(board, id) {
        const images = imagesByBoard[board];
        const idx = images.findIndex(function (img) { return img.id === id; });
        if (idx >= 0) images.splice(idx, 1);
    }

    function pushHistory(board, action) {
        historyByBoard[board].push(action);
        redoByBoard[board] = [];
    }

    function applyAction(board, action, addToHistory) {
        if (!action || !action.kind) return;

        if (action.kind === 'add_stroke') {
            strokesByBoard[board].push(deepClone(action.stroke));
        } else if (action.kind === 'add_image') {
            imagesByBoard[board].push(deepClone(action.image));
        } else if (action.kind === 'update_image') {
            const img = findImage(board, action.id);
            if (img) {
                img.x = action.after.x;
                img.y = action.after.y;
                img.w = action.after.w;
                img.h = action.after.h;
            }
        } else if (action.kind === 'clear_board') {
            strokesByBoard[board] = [];
            currentStrokeByBoard[board] = null;
            imagesByBoard[board] = [];
            selectedImageIdByBoard[board] = null;
        }

        if (addToHistory) pushHistory(board, deepClone(action));
    }

    function applyInverse(board, action) {
        if (!action || !action.kind) return;

        if (action.kind === 'add_stroke') {
            const strokes = strokesByBoard[board];
            for (let i = strokes.length - 1; i >= 0; i--) {
                if (strokes[i].id === action.stroke.id) {
                    strokes.splice(i, 1);
                    break;
                }
            }
        } else if (action.kind === 'add_image') {
            removeImageById(board, action.image.id);
            if (selectedImageIdByBoard[board] === action.image.id) selectedImageIdByBoard[board] = null;
        } else if (action.kind === 'update_image') {
            const img = findImage(board, action.id);
            if (img) {
                img.x = action.before.x;
                img.y = action.before.y;
                img.w = action.before.w;
                img.h = action.before.h;
            }
        } else if (action.kind === 'clear_board') {
            strokesByBoard[board] = deepClone(action.before.strokes);
            imagesByBoard[board] = deepClone(action.before.images);
        }
    }

    function doUndo(board) {
        if (currentStrokeByBoard[board] && currentStrokeByBoard[board].points.length > 0) {
            const forced = currentStrokeByBoard[board];
            currentStrokeByBoard[board] = null;
            applyAction(board, { kind: 'add_stroke', stroke: deepClone(forced) }, true);
        }

        const hist = historyByBoard[board];
        if (!hist.length) return;
        const action = hist.pop();
        applyInverse(board, action);
        redoByBoard[board].push(action);
    }

    function doRedo(board) {
        const redo = redoByBoard[board];
        if (!redo.length) return;
        const action = redo.pop();
        applyAction(board, action, false);
        historyByBoard[board].push(action);
    }

    function handleMessage(msg) {
        if (!msg || !msg.type) return;

        if (msg.type === 'set_board') return;

        const b = getBoardIndex(msg.board);

        if (msg.type === 'undo') {
            doUndo(b);
            return;
        }
        if (msg.type === 'redo') {
            doRedo(b);
            return;
        }
        if (msg.type === 'clear_board') {
            const before = {
                strokes: deepClone(strokesByBoard[b]),
                images: deepClone(imagesByBoard[b])
            };
            applyAction(b, { kind: 'clear_board', before: before }, true);
            return;
        }
        if (msg.type === 'image_add') {
            if (!msg.image || !msg.image.id) return;
            applyAction(b, { kind: 'add_image', image: deepClone(msg.image) }, true);
            return;
        }
        if (msg.type === 'image_update') {
            if (!msg.id || !msg.after) return;
            if (msg.commit && msg.before) {
                applyAction(b, {
                    kind: 'update_image',
                    id: msg.id,
                    before: deepClone(msg.before),
                    after: deepClone(msg.after)
                }, true);
            } else {
                const img = findImage(b, msg.id);
                if (img) {
                    img.x = msg.after.x;
                    img.y = msg.after.y;
                    img.w = msg.after.w;
                    img.h = msg.after.h;
                }
            }
            return;
        }
        if (msg.type !== 'draw') return;

        const strokes = strokesByBoard[b];
        let currentStroke = currentStrokeByBoard[b];
        const x = clampWorldX(msg.x);
        const y = clampWorldY(msg.y);
        const drawing = msg.drawing === true;
        const strokeTool = msg.tool || 'pen';
        const strokeColor = msg.color || '#000000';
        const strokeSize = strokeTool === 'eraser' ? Math.max(ERASER_MIN_SIZE, msg.size || 4) : Math.max(1, msg.size || 4);
        const strokeId = msg.strokeId || genId('stroke');

        if (drawing) {
            if (!currentStroke || currentStroke.id !== strokeId) {
                if (currentStroke && currentStroke.points.length > 0) {
                    strokes.push(currentStroke);
                    pushHistory(b, { kind: 'add_stroke', stroke: deepClone(currentStroke) });
                }
                currentStroke = { id: strokeId, tool: strokeTool, color: strokeColor, size: strokeSize, points: [] };
            }
            currentStroke.points.push({ x: x, y: y });
            currentStrokeByBoard[b] = currentStroke;
        } else {
            if (currentStroke && currentStroke.points.length > 0) {
                strokes.push(currentStroke);
                pushHistory(b, { kind: 'add_stroke', stroke: deepClone(currentStroke) });
            }
            currentStrokeByBoard[b] = null;
        }
    }

    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onmessage = function (event) {
            try {
                handleMessage(JSON.parse(event.data));
            } catch (_) {}
        };
        socket.onclose = function () { setTimeout(connect, 2000); };
    }
    connect();

    function clampWorldX(x) { return Math.max(0, Math.min(WORLD_W, Number(x) || 0)); }
    function clampWorldY(y) { return Math.max(0, Math.min(WORLD_H, Number(y) || 0)); }

    function send(data) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(data));
        }
    }

    function updateContentArea() {
        const w = Math.max(1, canvas.width);
        const h = Math.max(1, canvas.height);
        const boardAspect = WORLD_W / WORLD_H;
        const canvasAspect = w / h;

        if (canvasAspect >= boardAspect) {
            contentHeight = h;
            contentWidth = Math.round(h * boardAspect);
            contentLeft = Math.floor((w - contentWidth) / 2);
            contentTop = 0;
        } else {
            contentWidth = w;
            contentHeight = Math.round(w / boardAspect);
            contentLeft = 0;
            contentTop = Math.floor((h - contentHeight) / 2);
        }
    }

    function resize() {
        const toolbar = document.getElementById('toolbar');
        const th = toolbar ? toolbar.getBoundingClientRect().height : TOOLBAR_H;
        const w = window.innerWidth;
        const h = Math.max(200, window.innerHeight - th);
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        updateContentArea();
    }
    window.addEventListener('resize', resize);
    function doResize() { resize(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', doResize);
    else doResize();
    setTimeout(doResize, 150);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    function clampCamera() {
        const viewW = WORLD_W / zoom;
        const viewH = WORLD_H / zoom;
        if (viewW >= WORLD_W) camX = WORLD_W / 2;
        else camX = Math.max(viewW / 2, Math.min(WORLD_W - viewW / 2, camX));
        if (viewH >= WORLD_H) camY = WORLD_H / 2;
        else camY = Math.max(viewH / 2, Math.min(WORLD_H - viewH / 2, camY));
    }

    function screenToWorld(screenX, screenY) {
        if (contentWidth <= 0 || contentHeight <= 0) return { x: camX, y: camY };
        const contentPx = screenX - contentLeft;
        const contentPy = screenY - contentTop;
        const viewW = WORLD_W / zoom;
        const viewH = WORLD_H / zoom;
        const worldX = camX - viewW / 2 + contentPx * (viewW / contentWidth);
        const worldY = camY - viewH / 2 + contentPy * (viewH / contentHeight);
        return { x: clampWorldX(worldX), y: clampWorldY(worldY) };
    }

    function worldToScreen(worldX, worldY) {
        if (contentWidth <= 0 || contentHeight <= 0) return { x: contentLeft, y: contentTop };
        const viewW = WORLD_W / zoom;
        const viewH = WORLD_H / zoom;
        const contentPx = (worldX - (camX - viewW / 2)) * (contentWidth / viewW);
        const contentPy = (worldY - (camY - viewH / 2)) * (contentHeight / viewH);
        return { x: contentLeft + contentPx, y: contentTop + contentPy };
    }

    function worldSizeToScreen(worldSize) {
        if (contentWidth <= 0) return Math.max(1, worldSize);
        const viewW = WORLD_W / zoom;
        return Math.max(1, worldSize * (contentWidth / viewW));
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function saveCamera() {
        cameraByBoard[currentBoard] = { camX: camX, camY: camY, zoom: zoom };
    }

    function loadCamera() {
        const c = cameraByBoard[currentBoard];
        camX = c.camX;
        camY = c.camY;
        zoom = c.zoom;
        zoomSlider.value = Math.round(zoom * 100);
        zoomValue.textContent = Math.round(zoom * 100) + '%';
    }

    function goToBoard(index) {
        if (index === currentBoard) return;
        saveCamera();
        currentBoard = Math.max(0, Math.min(NUM_BOARDS - 1, index));
        loadCamera();
        boardLabel.textContent = (currentBoard + 1) + ' / ' + NUM_BOARDS;
        send({ type: 'set_board', board: currentBoard });
    }

    function setTool(nextTool) {
        tool = nextTool;
        penBtn.classList.toggle('active', tool === 'pen');
        eraserBtn.classList.toggle('active', tool === 'eraser');
        moveBtn.classList.toggle('active', tool === 'move');
        selectBtn.classList.toggle('active', tool === 'select');
    }

    prevBoardBtn.addEventListener('click', function () { goToBoard(currentBoard - 1); });
    nextBoardBtn.addEventListener('click', function () { goToBoard(currentBoard + 1); });
    resetCamBtn.addEventListener('click', function () {
        camX = WORLD_W / 2;
        camY = WORLD_H / 2;
        zoom = 1;
        zoomSlider.value = 100;
        zoomValue.textContent = '100%';
        cameraByBoard[currentBoard] = { camX: camX, camY: camY, zoom: zoom };
    });
    undoBtn.addEventListener('click', function () { send({ type: 'undo', board: currentBoard }); });
    redoBtn.addEventListener('click', function () { send({ type: 'redo', board: currentBoard }); });
    clearBoardBtn.addEventListener('click', function () { send({ type: 'clear_board', board: currentBoard }); });

    colorPicker.addEventListener('input', function () { color = colorPicker.value; });
    sizeSlider.addEventListener('input', function () { size = parseInt(sizeSlider.value, 10); });
    penBtn.addEventListener('click', function () { setTool('pen'); });
    eraserBtn.addEventListener('click', function () { setTool('eraser'); });
    moveBtn.addEventListener('click', function () { setTool('move'); });
    selectBtn.addEventListener('click', function () { setTool('select'); });
    zoomSlider.addEventListener('input', function () {
        const pct = parseInt(zoomSlider.value, 10);
        zoom = pct / 100;
        zoomValue.textContent = pct + '%';
        clampCamera();
    });

    addImageBtn.addEventListener('click', function () { imageInput.click(); });
    imageInput.addEventListener('change', function () {
        const file = imageInput.files && imageInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function () {
            const src = String(reader.result || '');
            if (!src) return;

            const img = new Image();
            img.onload = function () {
                const viewW = WORLD_W / zoom;
                const targetW = Math.min(800, Math.max(180, viewW * 0.45));
                const ratio = img.naturalHeight > 0 ? (img.naturalWidth / img.naturalHeight) : 1;
                const targetH = targetW / Math.max(0.05, ratio);
                const x = clampWorldX(camX - targetW / 2);
                const y = clampWorldY(camY - targetH / 2);
                send({
                    type: 'image_add',
                    board: currentBoard,
                    image: { id: genId('img'), src: src, x: x, y: y, w: targetW, h: targetH }
                });
                imageInput.value = '';
            };
            img.src = src;
        };
        reader.readAsDataURL(file);
    });

    function effectiveSize() {
        return tool === 'eraser' ? Math.max(ERASER_MIN_SIZE, size) : size;
    }

    function maybeSend(worldX, worldY, drawing) {
        const now = performance.now();
        if (drawing && lastSentWorld && (now - lastSentTime) < SEND_THROTTLE_MS) return;
        lastSentTime = now;
        const x = clampWorldX(worldX);
        const y = clampWorldY(worldY);
        lastSentWorld = { x: x, y: y };
        send({
            type: 'draw',
            board: currentBoard,
            strokeId: activeStrokeId,
            tool: tool,
            color: tool === 'pen' ? color : '#000000',
            size: effectiveSize(),
            x: x,
            y: y,
            drawing: drawing
        });
    }

    function drawPreviewDot(screenX, screenY) {
        lastPreviewScreenX = screenX;
        lastPreviewScreenY = screenY;
    }

    function drawImageObj(img) {
        let cached = imageCache.get(img.id);
        if (!cached || cached.src !== img.src) {
            cached = new Image();
            cached.src = img.src;
            imageCache.set(img.id, cached);
        }
        if (cached.complete && cached.naturalWidth > 0) {
            const a = worldToScreen(img.x, img.y);
            const b = worldToScreen(img.x + img.w, img.y + img.h);
            ctx.drawImage(cached, a.x, a.y, b.x - a.x, b.y - a.y);
        }
    }

    function drawSelection() {
        const selectedId = selectedImageIdByBoard[currentBoard];
        if (!selectedId) return;
        const img = findImage(currentBoard, selectedId);
        if (!img) return;

        const a = worldToScreen(img.x, img.y);
        const b = worldToScreen(img.x + img.w, img.y + img.h);

        ctx.save();
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);

        const hs = worldSizeToScreen(HANDLE_SIZE_WORLD);
        ctx.fillStyle = '#1976d2';
        ctx.fillRect(b.x - hs / 2, b.y - hs / 2, hs, hs);
        ctx.restore();
    }

    function drawBoardAndGridAndStrokes() {
        ctx.fillStyle = '#37474f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(contentLeft, contentTop, contentWidth, contentHeight);

        if (contentWidth <= 0 || contentHeight <= 0) return;

        const viewW = WORLD_W / zoom;
        const viewH = WORLD_H / zoom;
        const left = camX - viewW / 2;
        const top = camY - viewH / 2;
        const right = camX + viewW / 2;
        const bottom = camY + viewH / 2;

        const gridStep = zoom < 0.5 ? 200 : zoom < 1 ? 100 : 50;
        const startX = Math.max(0, Math.floor(left / gridStep) * gridStep);
        const startY = Math.max(0, Math.floor(top / gridStep) * gridStep);
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1;
        for (let wx = startX; wx <= Math.min(WORLD_W, right + gridStep); wx += gridStep) {
            const p1 = worldToScreen(wx, Math.max(0, top - 50));
            const p2 = worldToScreen(wx, Math.min(WORLD_H, bottom + 50));
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }
        for (let wy = startY; wy <= Math.min(WORLD_H, bottom + gridStep); wy += gridStep) {
            const p1 = worldToScreen(Math.max(0, left - 50), wy);
            const p2 = worldToScreen(Math.min(WORLD_W, right + 50), wy);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        }

        const images = imagesByBoard[currentBoard];
        for (let i = 0; i < images.length; i++) drawImageObj(images[i]);

        const strokes = strokesByBoard[currentBoard];
        for (let i = 0; i < strokes.length; i++) {
            const s = strokes[i];
            const pts = s.points;
            if (pts.length < 2) continue;
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = s.color;
            }
            ctx.lineWidth = worldSizeToScreen(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToScreen(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToScreen(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        const currentStroke = currentStrokeByBoard[currentBoard];
        if (currentStroke && currentStroke.points.length > 0) {
            const s = currentStroke;
            const pts = s.points;
            if (s.tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = s.color;
            }
            ctx.lineWidth = worldSizeToScreen(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToScreen(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToScreen(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        drawSelection();

        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(contentLeft, contentTop, contentWidth, contentHeight);
    }

    function loop() {
        drawBoardAndGridAndStrokes();
        if ((tool === 'pen' || tool === 'eraser') && lastPreviewScreenX >= 0 && lastPreviewScreenY >= 0) {
            const radius = worldSizeToScreen(effectiveSize());
            ctx.fillStyle = tool === 'eraser' ? '#fff' : color;
            ctx.beginPath();
            ctx.arc(lastPreviewScreenX, lastPreviewScreenY, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        requestAnimationFrame(loop);
    }
    loop();

    function imageHitTest(worldX, worldY) {
        const images = imagesByBoard[currentBoard];
        for (let i = images.length - 1; i >= 0; i--) {
            const img = images[i];
            if (worldX >= img.x && worldX <= img.x + img.w && worldY >= img.y && worldY <= img.y + img.h) {
                return img;
            }
        }
        return null;
    }

    function inResizeHandle(img, worldX, worldY) {
        const hs = HANDLE_SIZE_WORLD;
        return Math.abs(worldX - (img.x + img.w)) <= hs && Math.abs(worldY - (img.y + img.h)) <= hs;
    }

    function onPointerDown(e) {
        e.preventDefault();
        if (canvas.setPointerCapture) {
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
        const coords = getCanvasCoords(e);

        if (tool === 'move') {
            panStartScreenX = coords.x;
            panStartScreenY = coords.y;
            camStartX = camX;
            camStartY = camY;
            activePointerId = e.pointerId;
            return;
        }

        const world = screenToWorld(coords.x, coords.y);

        if (tool === 'select') {
            const selectedId = selectedImageIdByBoard[currentBoard];
            const selected = selectedId ? findImage(currentBoard, selectedId) : null;
            if (selected && inResizeHandle(selected, world.x, world.y)) {
                imageEditMode = 'resize-se';
                imageEditStartWorld = world;
                imageEditStartRect = { x: selected.x, y: selected.y, w: selected.w, h: selected.h };
                activePointerId = e.pointerId;
                return;
            }

            const hit = imageHitTest(world.x, world.y);
            if (hit) {
                selectedImageIdByBoard[currentBoard] = hit.id;
                imageEditMode = 'move';
                imageEditStartWorld = world;
                imageEditStartRect = { x: hit.x, y: hit.y, w: hit.w, h: hit.h };
                activePointerId = e.pointerId;
            } else {
                selectedImageIdByBoard[currentBoard] = null;
            }
            return;
        }

        activePointerId = e.pointerId;
        isDrawing = true;
        activeStrokeId = genId('stroke');
        maybeSend(world.x, world.y, true);
        drawPreviewDot(coords.x, coords.y);
    }

    function onPointerMove(e) {
        e.preventDefault();
        const coords = getCanvasCoords(e);

        if (tool === 'move') {
            if (activePointerId !== e.pointerId) return;
            if (contentWidth <= 0 || contentHeight <= 0) return;
            const viewW = WORLD_W / zoom;
            const viewH = WORLD_H / zoom;
            const worldPerPixelX = viewW / contentWidth;
            const worldPerPixelY = viewH / contentHeight;
            const dx = coords.x - panStartScreenX;
            const dy = coords.y - panStartScreenY;
            camX = camStartX - dx * worldPerPixelX;
            camY = camStartY - dy * worldPerPixelY;
            clampCamera();
            return;
        }

        if (tool === 'select') {
            if (activePointerId !== e.pointerId || !imageEditMode) return;
            const world = screenToWorld(coords.x, coords.y);
            const id = selectedImageIdByBoard[currentBoard];
            const img = id ? findImage(currentBoard, id) : null;
            if (!img || !imageEditStartRect || !imageEditStartWorld) return;

            if (imageEditMode === 'move') {
                const dx = world.x - imageEditStartWorld.x;
                const dy = world.y - imageEditStartWorld.y;
                img.x = clampWorldX(imageEditStartRect.x + dx);
                img.y = clampWorldY(imageEditStartRect.y + dy);
                img.x = Math.min(img.x, WORLD_W - img.w);
                img.y = Math.min(img.y, WORLD_H - img.h);
            } else if (imageEditMode === 'resize-se') {
                const minSize = 40;
                const nextW = Math.max(minSize, imageEditStartRect.w + (world.x - imageEditStartWorld.x));
                const nextH = Math.max(minSize, imageEditStartRect.h + (world.y - imageEditStartWorld.y));
                img.w = Math.min(nextW, WORLD_W - img.x);
                img.h = Math.min(nextH, WORLD_H - img.y);
            }
            send({
                type: 'image_update',
                board: currentBoard,
                id: img.id,
                after: { x: img.x, y: img.y, w: img.w, h: img.h },
                commit: false
            });
            return;
        }

        if (isDrawing && activePointerId === e.pointerId) {
            const world = screenToWorld(coords.x, coords.y);
            maybeSend(world.x, world.y, true);
            drawPreviewDot(coords.x, coords.y);
        }
    }

    function onPointerUp(e) {
        if (e.pointerId !== activePointerId) return;

        if (tool === 'pen' || tool === 'eraser') {
            const w = lastSentWorld || { x: 0, y: 0 };
            maybeSend(w.x, w.y, false);
            isDrawing = false;
            activeStrokeId = null;
            lastPreviewScreenX = -1;
            lastPreviewScreenY = -1;
        }

        if (tool === 'select' && imageEditMode) {
            const id = selectedImageIdByBoard[currentBoard];
            const img = id ? findImage(currentBoard, id) : null;
            if (img && imageEditStartRect) {
                const before = deepClone(imageEditStartRect);
                const after = { x: img.x, y: img.y, w: img.w, h: img.h };
                if (before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h) {
                    send({
                        type: 'image_update',
                        board: currentBoard,
                        id: img.id,
                        before: before,
                        after: after,
                        commit: true
                    });
                }
            }
            imageEditMode = null;
            imageEditStartWorld = null;
            imageEditStartRect = null;
        }

        activePointerId = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    boardLabel.textContent = '1 / ' + NUM_BOARDS;
    setTool('pen');
    send({ type: 'set_board', board: 0 });
})();
