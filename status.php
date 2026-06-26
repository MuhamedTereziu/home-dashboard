<?php
// CORS protection - allow only subdomains of 1234.al or same-origin
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    if (preg_match('/^https?:\/\/([a-z0-9-]+\.)*1234\.al$/i', $origin)) {
        header("Access-Control-Allow-Origin: " . $origin);
        header("Access-Control-Allow-Credentials: true");
        header("Access-Control-Allow-Headers: Content-Type, Authorization");
        header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    }
}

// Handle OPTIONS preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

header("Content-Type: application/json");

// Configure session security
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_secure', 0); // Disable secure flag to support SSL-terminating proxies
ini_set('session.cookie_samesite', 'Lax'); // Use Lax for better compatibility
session_start();

// Define secure password SHA-256 hash (for "1")
define('PASSWORD_HASH', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b');
// Web camera streamer token (SHA-256 hash of "1")
define('WEBCAM_TOKEN', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b');

$action = $_GET['action'] ?? '';

// Login action
if ($action === 'login') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(["success" => false, "error" => "Method Not Allowed"]);
        exit;
    }
    
    $password = '';
    // Support JSON or form-urlencoded POST
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($contentType, 'application/json') !== false) {
        $input = json_decode(file_get_contents('php://input'), true);
        $password = $input['password'] ?? '';
    } else {
        $password = $_POST['password'] ?? '';
    }
    
    if (hash_equals(PASSWORD_HASH, hash('sha256', $password))) {
        $_SESSION['authenticated'] = true;
        echo json_encode(["success" => true]);
    } else {
        http_response_code(401);
        echo json_encode(["success" => false, "error" => "Invalid password"]);
    }
    exit;
}

// Logout action
if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    session_destroy();
    echo json_encode(["success" => true]);
    exit;
}

// Authenticate session for all subsequent requests
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    http_response_code(401);
    echo json_encode(["error" => "Unauthorized"]);
    exit;
}

// Retrieve webcam token
if ($action === 'get_webcam_token') {
    echo json_encode(["token" => WEBCAM_TOKEN]);
    exit;
}

// Check session validity
if ($action === 'check_session') {
    echo json_encode(["authenticated" => true]);
    exit;
}

// 1. Service Port Latency Monitoring (Disabled to stop specific container pings)
$services = [];

// 2. CPU Usage Calculation
$cpu = 0;
if (file_exists("/proc/stat")) {
    $raw1 = file_get_contents("/proc/stat");
    usleep(100000); // 100ms sleep for delta check
    $raw2 = file_get_contents("/proc/stat");
    $line1 = preg_split('/\s+/', trim(strtok($raw1, "\n")));
    $line2 = preg_split('/\s+/', trim(strtok($raw2, "\n")));
    if (count($line1) >= 5 && count($line2) >= 5) {
        $idle1  = (int)$line1[4];
        $total1 = 0; foreach (array_slice($line1, 1) as $v) $total1 += (int)$v;
        $idle2  = (int)$line2[4];
        $total2 = 0; foreach (array_slice($line2, 1) as $v) $total2 += (int)$v;
        $dt = $total2 - $total1;
        if ($dt > 0) $cpu = intval(round((1 - ($idle2 - $idle1) / $dt) * 100));
    }
} else {
    $load = sys_getloadavg();
    $cpu  = intval(round(min($load[0] * 25, 100)));
}

// 3. CPU Temperature Monitoring
$cpu_temp = null;
if (file_exists("/sys/class/thermal/thermal_zone0/temp")) {
    $cpu_temp = intval(round(intval(file_get_contents("/sys/class/thermal/thermal_zone0/temp")) / 1000));
}

// 4. Memory (RAM) Usage Details (GB + %)
$ram_pct = 0;
$ram_used = "0.0";
$ram_total = "0.0";
if (file_exists("/proc/meminfo")) {
    $mi = file_get_contents("/proc/meminfo");
    preg_match('/MemTotal:\s+(\d+)/', $mi, $mt);
    preg_match('/MemAvailable:\s+(\d+)/', $mi, $ma);
    if (!empty($mt[1])) {
        $ram_total_raw = $mt[1] / 1024 / 1024;
        $ram_total = sprintf("%.1f", $ram_total_raw);
        if (!empty($ma[1])) {
            $ram_used_raw = ($mt[1] - $ma[1]) / 1024 / 1024;
            $ram_used = sprintf("%.1f", $ram_used_raw);
            $ram_pct = intval(round(($ram_used_raw / $ram_total_raw) * 100));
        }
    }
}

// 5. Disk space details (GB + %)
$disk_pct = 0;
$disk_used = "0.0";
$disk_total = "0.0";
$dtotal = disk_total_space("/");
$dfree  = disk_free_space("/");
if ($dtotal > 0) {
    $disk_total_raw = $dtotal / 1073741824;
    $disk_used_raw  = ($dtotal - $dfree) / 1073741824;
    $disk_total = sprintf("%.1f", $disk_total_raw);
    $disk_used  = sprintf("%.1f", $disk_used_raw);
    $disk_pct   = intval(round(($disk_used_raw / $disk_total_raw) * 100));
}

// 6. Uptime String
$uptime = "--";
if (file_exists("/proc/uptime")) {
    $sec    = floatval(explode(" ", file_get_contents("/proc/uptime"))[0]);
    $d      = (int)floor($sec / 86400);
    $h      = (int)floor(($sec % 86400) / 3600);
    $m      = (int)floor(($sec % 3600) / 60);
    $uptime = $d > 0 ? "{$d}d {$h}h" : "{$h}h {$m}m";
}

// 7. Physical Network Bandwidth Utilization
function get_network_bytes() {
    if (!file_exists("/proc/net/dev")) return ["rx" => 0, "tx" => 0];
    $lines = file("/proc/net/dev");
    $rx = 0.0;
    $tx = 0.0;
    foreach ($lines as $line) {
        if (strpos($line, "|") !== false) continue;
        $parts = preg_split('/\s+/', trim($line));
        if (count($parts) < 10) continue;
        $iface = rtrim($parts[0], ":");
        if (!preg_match('/^(lo|docker|br-|veth|virbr)/', $iface)) {
            $rx += (float)$parts[1];
            $tx += (float)$parts[9];
        }
    }
    return ["rx" => $rx, "tx" => $tx];
}

$net_down = 0.0;
$net_up = 0.0;
$now = microtime(true);
$current_net = get_network_bytes();
$cache_file = "/tmp/net_speed_cache.json";

if (file_exists($cache_file)) {
    $cache = json_decode(file_get_contents($cache_file), true);
    if ($cache && isset($cache["time"]) && isset($cache["rx"]) && isset($cache["tx"])) {
        $dt = $now - $cache["time"];
        if ($dt > 0.1 && $dt < 60.0) {
            $net_down = ($current_net["rx"] - $cache["rx"]) / $dt;
            $net_up = ($current_net["tx"] - $cache["tx"]) / $dt;
            if ($net_down < 0) $net_down = 0.0;
            if ($net_up < 0) $net_up = 0.0;
        }
    }
}

file_put_contents($cache_file, json_encode([
    "time" => $now,
    "rx" => $current_net["rx"],
    "tx" => $current_net["tx"]
]));

// Return JSON payload
echo json_encode([
    "services" => $services,
    "system"   => [
        "cpu"        => $cpu,
        "cpu_temp"   => $cpu_temp,
        "ram"        => $ram_pct,
        "ram_used"   => $ram_used,
        "ram_total"  => $ram_total,
        "disk"       => $disk_pct,
        "disk_used"  => $disk_used,
        "disk_total" => $disk_total,
        "uptime"     => $uptime,
        "net_down"   => intval(round($net_down)),
        "net_up"     => intval(round($net_up))
    ]
]);
