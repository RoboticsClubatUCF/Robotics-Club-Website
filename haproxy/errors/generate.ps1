# Generates HAProxy .http error files themed for the Robotics Club website.
# Run from the haproxy/errors/ directory:  powershell -File generate.ps1

$errors = @(
    @{ code = 400; status = "Bad Request";            title = "Malformed Signal";       msg = "The command you sent could not be decoded by our systems. Check your request syntax and try again." }
    @{ code = 401; status = "Unauthorized";           title = "Clearance Required";     msg = "Authentication is required to access this system. Please log in to continue." }
    @{ code = 403; status = "Forbidden";              title = "Access Denied";          msg = "Your credentials don&apos;t grant access to this zone. Contact an administrator if you believe this is an error." }
    @{ code = 404; status = "Not Found";              title = "Component Missing";      msg = "The requested module wasn&apos;t found in our systems. It may have been moved or decommissioned." }
    @{ code = 405; status = "Method Not Allowed";     title = "Invalid Command";        msg = "The operation you attempted is not permitted on this endpoint. Verify the request method and try again." }
    @{ code = 407; status = "Proxy Auth Required";    title = "Proxy Clearance Needed"; msg = "Proxy authentication is required before you can reach this resource. Configure your credentials and retry." }
    @{ code = 408; status = "Request Timeout";        title = "Signal Timeout";         msg = "Your connection took too long to transmit. The request has been terminated &mdash; please try again." }
    @{ code = 410; status = "Gone";                   title = "Unit Decommissioned";    msg = "This resource has been permanently removed from service and will not return. Update your links accordingly." }
    @{ code = 413; status = "Payload Too Large";      title = "Payload Overload";       msg = "Your request exceeds our system&apos;s capacity limits. Reduce the payload size and try again." }
    @{ code = 425; status = "Too Early";              title = "Premature Signal";       msg = "The server isn&apos;t ready to process this request yet. Stand by and try again in a moment." }
    @{ code = 429; status = "Too Many Requests";      title = "Throttle Limit";         msg = "You&apos;ve exceeded the allowed request rate. Power down briefly and try again." }
    @{ code = 500; status = "Internal Server Error";  title = "System Failure";         msg = "An unexpected fault occurred in the control system. Our team has been alerted and is working on a fix." }
    @{ code = 501; status = "Not Implemented";        title = "Unknown Protocol";       msg = "This function has not been implemented in the current system version. Check back later." }
    @{ code = 502; status = "Bad Gateway";            title = "Relay Failure";          msg = "The upstream relay returned an invalid response. The communication link has failed &mdash; please retry." }
    @{ code = 503; status = "Service Unavailable";    title = "System Offline";         msg = "The system is temporarily offline for maintenance. Our crew is working to restore operations. Stand by." }
    @{ code = 504; status = "Gateway Timeout";        title = "Upstream Timeout";       msg = "The upstream system failed to respond in time. Please try again shortly." }
)

# Primary (gold) and outline (ghost) button HTML
function Btn-Primary($label, $href) { "<a href=""$href"" class=""btn"">$label</a>" }
function Btn-Outline($label, $href) { "<a href=""$href"" class=""btn-outline"">$label</a>" }
function Btn-Primary-JS($label, $js)  { "<button class=""btn"" onclick=""$js"">$label</button>" }
function Btn-Outline-JS($label, $js)  { "<button class=""btn-outline"" onclick=""$js"">$label</button>" }
function Btn-Outline-Ext($label, $href) { "<a href=""$href"" class=""btn-outline"" target=""_blank"" rel=""noopener noreferrer"">$label</a>" }

$actionMap = @{
    400 = @(Btn-Outline-JS "Go Back"     "history.back()";    Btn-Primary    "Return Home" "/")
    401 = @(Btn-Primary    "Sign In"     "/login";            Btn-Outline    "Return Home" "/")
    403 = @(Btn-Primary    "Sign In"     "/login";            Btn-Outline    "Return Home" "/")
    404 = @(Btn-Primary    "Return Home" "/")
    405 = @(Btn-Primary    "Return Home" "/")
    407 = @(Btn-Primary    "Return Home" "/")
    408 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline    "Return Home" "/")
    410 = @(Btn-Primary    "Return Home" "/")
    413 = @(Btn-Outline-JS "Go Back"     "history.back()";    Btn-Primary    "Return Home" "/")
    425 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline    "Return Home" "/")
    429 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline    "Return Home" "/")
    500 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline-Ext "Notify Officers" "https://discord.gg/m8XZahpNjR")
    501 = @(Btn-Primary    "Return Home" "/";                 Btn-Outline-Ext "Notify Officers" "https://discord.gg/m8XZahpNjR")
    502 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline-Ext "Notify Officers" "https://discord.gg/m8XZahpNjR")
    503 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline-Ext "Notify Officers" "https://discord.gg/m8XZahpNjR")
    504 = @(Btn-Primary-JS "Try Again"   "location.reload()"; Btn-Outline-Ext "Notify Officers" "https://discord.gg/m8XZahpNjR")
}

$css = '*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%}' +
       'body{background:#1a1a1a;color:#fff;font-family:''Montserrat'',''Segoe UI'',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:1rem}' +
       '.card{background:#212121;border-radius:8px;max-width:540px;width:100%;padding:2.5rem 2rem;text-align:center}' +
       '.code{font-family:''Orbitron'',''Impact'',monospace;font-size:4.5rem;font-weight:900;color:#FFC904;line-height:1;margin-bottom:.4rem}' +
       '.title{font-size:1rem;font-weight:700;color:#00C2CB;text-transform:uppercase;letter-spacing:.08em;margin-bottom:1.25rem}' +
       '.divider{width:50px;height:2px;background:#FFC904;margin:0 auto 1.25rem}' +
       '.msg{color:#ccc;line-height:1.6;margin-bottom:1.75rem;font-size:.9rem}' +
       '.actions{display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap}' +
       '.btn{display:inline-block;background:#FFC904;color:#000;font-family:''Montserrat'',''Segoe UI'',system-ui,sans-serif;font-weight:700;text-decoration:none;padding:.65rem 1.75rem;border-radius:8px;font-size:.875rem;border:none;cursor:pointer}' +
       '.btn:hover{background:#E6B504}' +
       '.btn-outline{display:inline-block;background:transparent;color:#FFC904;font-family:''Montserrat'',''Segoe UI'',system-ui,sans-serif;font-weight:700;text-decoration:none;padding:.63rem 1.75rem;border-radius:8px;font-size:.875rem;border:2px solid #FFC904;cursor:pointer}' +
       '.btn-outline:hover{background:rgba(255,201,4,.1)}'

foreach ($e in $errors) {
    $actions = ($actionMap[$e.code] -join "`n")

    $html = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$($e.code) $($e.status) &mdash; Robotics Club</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
<style>$css</style>
</head>
<body>
<div class="card">
<div class="code">$($e.code)</div>
<div class="title">$($e.title)</div>
<div class="divider"></div>
<p class="msg">$($e.msg)</p>
<div class="actions">
$actions
</div>
</div>
</body>
</html>
"@

    $bodyBytes = [System.Text.Encoding]::UTF8.GetByteCount($html)
    $path = Join-Path $PSScriptRoot "$($e.code).http"

    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $writer = [System.IO.StreamWriter]::new($stream, [System.Text.Encoding]::UTF8)
    $writer.NewLine = "`r`n"
    $writer.WriteLine("HTTP/1.1 $($e.code) $($e.status)")
    $writer.WriteLine("Content-Type: text/html; charset=utf-8")
    $writer.WriteLine("Content-Length: $bodyBytes")
    $writer.WriteLine("")
    $writer.Write($html)
    $writer.Flush()
    $writer.Close()

    Write-Host "Created $($e.code).http  ($bodyBytes bytes body)"
}

Write-Host "`nDone. Add to haproxy.cfg:"
Write-Host "  http-errors robotics-errors"
foreach ($e in $errors) {
    Write-Host "    errorfile $($e.code) /etc/haproxy/errors/$($e.code).http"
}
