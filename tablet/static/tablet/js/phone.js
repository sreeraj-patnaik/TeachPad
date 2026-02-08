/**
 * Phone: fixed 16:9 board, full-screen view. Multiple boards (slides). Pan/zoom per board.
 */
(function () {
    'use strict';

    const WORLD_W = 1920;
    const WORLD_H = 1080;
    const NUM_BOARDS = 10;
    const TOOLBAR_H = 52;
    const ERASER_MIN_SIZE = 12;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const colorPicker = document.getElementById('colorPicker');
    const sizeSlider = document.getElementById('sizeSlider');
    const penBtn = document.getElementById('penBtn');
    const eraserBtn = document.getElementById('eraserBtn');
    const moveBtn = document.getElementById('moveBtn');
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    const resetCamBtn = document.getElementById('resetCamBtn');
    const prevBoardBtn = document.getElementById('prevBoardBtn');
    const nextBoardBtn = document.getElementById('nextBoardBtn');
    const boardLabel = document.getElementById('boardLabel');

    let camX = WORLD_W / 2;
    let camY = WORLD_H / 2;
    let zoom = 1;

    // Full-screen: content area = entire canvas (maximize drawing area on phone)
    let contentWidth = 1;
    let contentHeight = 1;
    let contentLeft = 0;
    let contentTop = 0;

    let tool = 'pen';
    let color = '#000000';
    let size = 4;

    let isDrawing = false;
    let activePointerId = null;
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
    let strokesByBoard = [];
    let currentStrokeByBoard = [];
    let cameraByBoard = [];

    for (let i = 0; i < NUM_BOARDS; i++) {
        strokesByBoard.push([]);
        currentStrokeByBoard.push(null);
        cameraByBoard.push({ camX: WORLD_W / 2, camY: WORLD_H / 2, zoom: 1 });
    }

    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsScheme + '//' + window.location.host + '/ws/draw/';
    let socket = null;

    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onmessage = function (event) {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'set_board') {
                    const b = Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(msg.board, 10) || 0));
                    return;
                }
                if (msg.type !== 'draw') return;
                const b = Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(msg.board, 10) || 0));
                const strokes = strokesByBoard[b];
                let currentStroke = currentStrokeByBoard[b];
                const x = clampWorldX(msg.x);
                const y = clampWorldY(msg.y);
                const drawing = msg.drawing === true;
                const strokeTool = msg.tool || 'pen';
                const strokeColor = msg.color || '#000000';
                const strokeSize = msg.tool === 'eraser' ? Math.max(ERASER_MIN_SIZE, msg.size || 4) : Math.max(1, msg.size || 4);
                if (drawing) {
                    if (!currentStroke || currentStroke.tool !== strokeTool || currentStroke.color !== strokeColor || currentStroke.size !== strokeSize) {
                        if (currentStroke && currentStroke.points.length > 0) strokes.push(currentStroke);
                        currentStroke = { tool: strokeTool, color: strokeColor, size: strokeSize, points: [] };
                    }
                    currentStroke.points.push({ x: x, y: y });
                    currentStrokeByBoard[b] = currentStroke;
                } else {
                    if (currentStroke && currentStroke.points.length > 0) strokes.push(currentStroke);
                    currentStrokeByBoard[b] = null;
                }
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
        contentLeft = 0;
        contentTop = 0;
        contentWidth = w;
        contentHeight = h;
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

    colorPicker.addEventListener('input', function () { color = colorPicker.value; });
    sizeSlider.addEventListener('input', function () { size = parseInt(sizeSlider.value, 10); });
    penBtn.addEventListener('click', function () { tool = 'pen'; penBtn.classList.add('active'); eraserBtn.classList.remove('active'); moveBtn.classList.remove('active'); });
    eraserBtn.addEventListener('click', function () { tool = 'eraser'; eraserBtn.classList.add('active'); penBtn.classList.remove('active'); moveBtn.classList.remove('active'); });
    moveBtn.addEventListener('click', function () { tool = 'move'; moveBtn.classList.add('active'); penBtn.classList.remove('active'); eraserBtn.classList.remove('active'); });
    zoomSlider.addEventListener('input', function () {
        const pct = parseInt(zoomSlider.value, 10);
        zoom = pct / 100;
        zoomValue.textContent = pct + '%';
        clampCamera();
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

    function drawBoardAndGridAndStrokes() {
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
        let startX = Math.max(0, Math.floor(left / gridStep) * gridStep);
        let startY = Math.max(0, Math.floor(top / gridStep) * gridStep);
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
            const a = worldToScreen(pts[0].x, pts[0].y);
            ctx.moveTo(a.x, a.y);
            for (let j = 1; j < pts.length; j++) {
                const b = worldToScreen(pts[j].x, pts[j].y);
                ctx.lineTo(b.x, b.y);
            }
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        const currentStroke = currentStrokeByBoard[currentBoard];
        if (currentStroke && currentStroke.points.length > 0) {
            const s = currentStroke;
            const pts = s.points;
            if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
            else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; }
            ctx.lineWidth = worldSizeToScreen(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const a = worldToScreen(pts[0].x, pts[0].y);
            ctx.moveTo(a.x, a.y);
            for (let j = 1; j < pts.length; j++) {
                const b = worldToScreen(pts[j].x, pts[j].y);
                ctx.lineTo(b.x, b.y);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(contentLeft, contentTop, contentWidth, contentHeight);
    }

    function loop() {
        drawBoardAndGridAndStrokes();
        if (lastPreviewScreenX >= 0 && lastPreviewScreenY >= 0) {
            const radius = worldSizeToScreen(effectiveSize());
            ctx.fillStyle = tool === 'eraser' ? '#fff' : color;
            ctx.beginPath();
            ctx.arc(lastPreviewScreenX, lastPreviewScreenY, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        requestAnimationFrame(loop);
    }
    loop();

    function onPointerDown(e) {
        e.preventDefault();
        if (canvas.setPointerCapture) try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
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
        activePointerId = e.pointerId;
        isDrawing = true;
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

        if (isDrawing && activePointerId === e.pointerId) {
            const world = screenToWorld(coords.x, coords.y);
            maybeSend(world.x, world.y, true);
            drawPreviewDot(coords.x, coords.y);
        }
    }

    function onPointerUp(e) {
        if (e.pointerId === activePointerId) {
            if (tool === 'pen' || tool === 'eraser') {
                const w = lastSentWorld || { x: 0, y: 0 };
                maybeSend(w.x, w.y, false);
                isDrawing = false;
                lastPreviewScreenX = -1;
                lastPreviewScreenY = -1;
            }
            activePointerId = null;
        }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    boardLabel.textContent = '1 / ' + NUM_BOARDS;
    send({ type: 'set_board', board: 0 });
})();
