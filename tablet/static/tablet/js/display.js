/**
 * Display: fullscreen 16:9 board with strokes + image objects + history actions.
 */
(function () {
    'use strict';

    const WORLD_W = 1920;
    const WORLD_H = 1080;
    const NUM_BOARDS = 10;
    const ERASER_MIN_SIZE = 12;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const strokesByBoard = [];
    const currentStrokeByBoard = [];
    const imagesByBoard = [];
    const historyByBoard = [];
    const redoByBoard = [];

    const imageCache = new Map();

    let currentDisplayBoard = 0;

    for (let i = 0; i < NUM_BOARDS; i++) {
        strokesByBoard.push([]);
        currentStrokeByBoard.push(null);
        imagesByBoard.push([]);
        historyByBoard.push([]);
        redoByBoard.push([]);
    }

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsScheme + '//' + window.location.host + '/ws/draw/';
    let socket = null;

    function deepClone(v) {
        return JSON.parse(JSON.stringify(v));
    }

    function getBoardIndex(raw) {
        return Math.max(0, Math.min(NUM_BOARDS - 1, parseInt(raw, 10) || 0));
    }

    function pushHistory(board, action) {
        historyByBoard[board].push(action);
        redoByBoard[board] = [];
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

        if (msg.type === 'set_board') {
            currentDisplayBoard = getBoardIndex(msg.board);
            return;
        }

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
        const strokeId = msg.strokeId || ('stroke_' + Date.now());

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

    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        const fitScale = Math.min(w / WORLD_W, h / WORLD_H);
        scale = fitScale;
        offsetX = (w - WORLD_W * scale) / 2;
        offsetY = (h - WORLD_H * scale) / 2;
    }
    window.addEventListener('resize', resize);
    resize();

    function drawBoardBackground() {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(offsetX, offsetY, WORLD_W * scale, WORLD_H * scale);
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.strokeRect(offsetX, offsetY, WORLD_W * scale, WORLD_H * scale);
    }

    function worldToDisplay(x, y) {
        return { x: offsetX + x * scale, y: offsetY + y * scale };
    }

    function worldSizeToDisplay(s) {
        return Math.max(1, s * scale);
    }

    function clampWorldX(x) { return Math.max(0, Math.min(WORLD_W, Number(x) || 0)); }
    function clampWorldY(y) { return Math.max(0, Math.min(WORLD_H, Number(y) || 0)); }

    function drawImageObj(img) {
        let cached = imageCache.get(img.id);
        if (!cached || cached.src !== img.src) {
            cached = new Image();
            cached.src = img.src;
            imageCache.set(img.id, cached);
        }
        if (cached.complete && cached.naturalWidth > 0) {
            const a = worldToDisplay(img.x, img.y);
            const b = worldToDisplay(img.x + img.w, img.y + img.h);
            ctx.drawImage(cached, a.x, a.y, b.x - a.x, b.y - a.y);
        }
    }

    function drawStrokesForBoard(boardIndex) {
        const images = imagesByBoard[boardIndex];
        for (let i = 0; i < images.length; i++) drawImageObj(images[i]);

        const strokes = strokesByBoard[boardIndex];
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
            ctx.lineWidth = worldSizeToDisplay(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToDisplay(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToDisplay(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';

        const currentStroke = currentStrokeByBoard[boardIndex];
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
            ctx.lineWidth = worldSizeToDisplay(s.size);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const p0 = worldToDisplay(pts[0].x, pts[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let j = 1; j < pts.length; j++) {
                const p = worldToDisplay(pts[j].x, pts[j].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function tick() {
        drawBoardBackground();
        drawStrokesForBoard(currentDisplayBoard);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
