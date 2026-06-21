<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

$ports = [
    "flood"    => 9991,
    "immich"   => 2283,
    "cockpit"  => 9090,
    "stats"    => 8090,
    "alist"    => 5244,
    "plex"     => 32400,
    "jellyfin" => 8096
];

$services = [];
foreach ($ports as $name => $port) {
    $connection = @fsockopen("127.0.0.1", $port, $errno, $errstr, 0.4);
    if (is_resource($connection)) {
        $services[$name] = true;
        fclose($connection);
    } else {
        $services[$name] = false;
    }
}

// CPU usage (two-sample /proc/stat)
$cpu = 0;
if (file_exists("/proc/stat")) {
    $raw1 = file_get_contents("/proc/stat");
    usleep(200000);
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

// RAM usage (integer %)
$ram = 0;
if (file_exists("/proc/meminfo")) {
    $mi = file_get_contents("/proc/meminfo");
    preg_match('/MemTotal:\s+(\d+)/', $mi, $mt);
    preg_match('/MemAvailable:\s+(\d+)/', $mi, $ma);
    if (!empty($mt[1]) && !empty($ma[1]) && (int)$mt[1] > 0) {
        $ram = intval(round((($mt[1] - $ma[1]) / $mt[1]) * 100));
    }
}

// Disk usage (integer %)
$disk = 0;
$dtotal = disk_total_space("/");
$dfree  = disk_free_space("/");
if ($dtotal > 0) $disk = intval(round((($dtotal - $dfree) / $dtotal) * 100));

// Uptime string
$uptime = "--";
if (file_exists("/proc/uptime")) {
    $sec    = floatval(explode(" ", file_get_contents("/proc/uptime"))[0]);
    $d      = (int)floor($sec / 86400);
    $h      = (int)floor(($sec % 86400) / 3600);
    $m      = (int)floor(($sec % 3600) / 60);
    $uptime = $d > 0 ? "{$d}d {$h}h" : "{$h}h {$m}m";
}

echo json_encode([
    "services" => $services,
    "system"   => [
        "cpu"    => $cpu,
        "ram"    => $ram,
        "disk"   => $disk,
        "uptime" => $uptime
    ]
]);
