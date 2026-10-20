<?php

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    header('Allow: GET, HEAD');
    http_response_code(405);
    exit;
}
if (!class_exists('ZipArchive')) {
    http_response_code(503);
    exit;
}

$server = isset($_GET['s']) ? $_GET['s'] : null;
$layer = isset($_GET['layer']) ? $_GET['layer'] : null;
$zoom = isset($_GET['z']) ? $_GET['z'] : null;
$x = isset($_GET['x']) ? $_GET['x'] : null;
$y = isset($_GET['y']) ? $_GET['y'] : null;
if (!is_string($server) || !preg_match('/^server-[a-f0-9]{24}$/D', $server)
    || ($layer !== 'terrain' && $layer !== 'satellite')
    || !is_string($zoom) || !preg_match('/^-?[0-9]{1,15}$/D', $zoom)
    || !is_string($x) || !preg_match('/^-?[0-9]{1,15}$/D', $x)
    || !is_string($y) || !preg_match('/^-?[0-9]{1,15}$/D', $y)) {
    http_response_code(400);
    exit;
}

$archivePath = __DIR__ . '/' . $server . '/'
    . ($layer === 'satellite' ? 'satellite/' : '') . $zoom . '/' . $x . '.zip';
if (!is_file($archivePath)) {
    http_response_code(404);
    exit;
}

$archive = new ZipArchive();
if ($archive->open($archivePath) !== true) {
    http_response_code(503);
    exit;
}

$entryName = $y . '.png';
$entry = $archive->statName($entryName);
if ($entry === false) {
    $archive->close();
    http_response_code(404);
    exit;
}
$stream = $archive->getStream($entryName);
if ($stream === false) {
    $archive->close();
    http_response_code(503);
    exit;
}

header('Content-Type: image/png');
header('Content-Length: ' . $entry['size']);
header('Cache-Control: public, max-age=60');
header('X-Content-Type-Options: nosniff');
if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    fpassthru($stream);
}
fclose($stream);
$archive->close();
