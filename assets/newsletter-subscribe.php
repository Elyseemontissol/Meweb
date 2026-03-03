<?php
// newsletter-subscribe.php

$to = "Info@MontissolEssentials.com";
$siteName = "Montissol Essentials";
$redirectSuccess = "index.html?subscribed=1";  // change to whatever page the form is on
$redirectFail    = "index.html?subscribed=0";

// Only accept POST
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  header("Location: $redirectFail");
  exit;
}

// Honeypot
$honeypot = trim($_POST["company"] ?? "");
if ($honeypot !== "") {
  // Treat as success so bots don't learn
  header("Location: $redirectSuccess");
  exit;
}

// Validate email
$email = trim($_POST["email"] ?? "");
if ($email === "" || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
  header("Location: $redirectFail");
  exit;
}

// Where to store subscribers
$dir = __DIR__ . "/data";
$file = $dir . "/newsletter-subscribers.csv";

// Create data folder if needed
if (!is_dir($dir)) {
  mkdir($dir, 0755, true);
}

// Prevent duplicates (simple)
$lower = strtolower($email);
$existing = [];
if (file_exists($file)) {
  $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  foreach ($lines as $line) {
    $parts = str_getcsv($line);
    if (!empty($parts[0])) $existing[strtolower(trim($parts[0]))] = true;
  }
}
if (isset($existing[$lower])) {
  header("Location: $redirectSuccess");
  exit;
}

// Append to CSV: email, timestamp, ip, page
$ip = $_SERVER["REMOTE_ADDR"] ?? "unknown";
$ref = $_SERVER["HTTP_REFERER"] ?? "";
$ts = gmdate("Y-m-d H:i:s") . " UTC";

$row = [$email, $ts, $ip, $ref];

$fp = fopen($file, "a");
fputcsv($fp, $row);
fclose($fp);

// Notify you (optional)
$subject = "New Newsletter Subscriber";
$body  = "New newsletter subscription on $siteName\n\n";
$body .= "Email: $email\n";
$body .= "Time: $ts\n";
$body .= "IP: $ip\n";
$body .= "Referrer: $ref\n";

$headers = [];
$headers[] = "MIME-Version: 1.0";
$headers[] = "Content-Type: text/plain; charset=UTF-8";
$headers[] = "From: $siteName <no-reply@" . ($_SERVER["SERVER_NAME"] ?? "localhost") . ">";

@mail($to, $subject, $body, implode("\r\n", $headers));

header("Location: $redirectSuccess");
exit;