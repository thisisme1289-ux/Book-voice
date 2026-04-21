
d353c77b-1d03-48a2-afc7-45870a38ef0e:1 Loading the script 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js' violates the following Content Security Policy directive: "script-src-elem 'self' 'unsafe-inline'
    https://cdnjs.cloudflare.com
    https://unpkg.com
    https://code.responsivevoice.org
    https://sdk.amazonaws.com
    https://checkout.razorpay.com
    https://cdn.razorpay.com". The action has been blocked.
(anonymous) @ d353c77b-1d03-48a2-afc7-45870a38ef0e:1
Worker Created
(anonymous) @ spawnWorker.js:14
(anonymous) @ createWorker.js:46
tryCatch @ createWorker.js:2
(anonymous) @ createWorker.js:2
(anonymous) @ createWorker.js:2
asyncGeneratorStep @ createWorker.js:2
_next @ createWorker.js:2
(anonymous) @ createWorker.js:2
(anonymous) @ createWorker.js:2
getTesseractWorker @ (index):1750
extractPageText @ (index):1811
await in extractPageText
parsePDF @ (index):2125
await in parsePDF
handleFileLoad @ (index):1715
await in handleFileLoad
handler @ (index):1694
(index):2239 PDF parse error: Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js' failed to load.
parsePDF @ (index):2239
await in parsePDF
handleFileLoad @ (index):1715
await in handleFileLoad
handler @ (index):1694
d353c77b-1d03-48a2-afc7-45870a38ef0e:1 Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js' failed to load.
    at d353c77b-1d03-48a2-afc7-45870a38ef0e:1:1
(anonymous) @ d353c77b-1d03-48a2-afc7-45870a38ef0e:1
Worker Created
(anonymous) @ spawnWorker.js:14
(anonymous) @ createWorker.js:46
tryCatch @ createWorker.js:2
(anonymous) @ createWorker.js:2
(anonymous) @ createWorker.js:2
asyncGeneratorStep @ createWorker.js:2
_next @ createWorker.js:2
(anonymous) @ createWorker.js:2
(anonymous) @ createWorker.js:2
getTesseractWorker @ (index):1750
extractPageText @ (index):1811
await in extractPageText
parsePDF @ (index):2125
await in parsePDF
handleFileLoad @ (index):1715
await in handleFileLoad
handler @ (index):1694
