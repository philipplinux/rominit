#!/bin/sh
# ROMinit phone test for Linux ROMs (postmarketOS and friends). Silent inventory by default.
# Tone and buzz checks only run when the user opts in with ROMINIT_SOUND=1.
# Lax on purpose: a bound driver that sees its hardware counts as "full"; "ask" stays for what only a human can judge.
# Output, one line each: "<feature> <status> <note>". Status: full partial broken blocked untested ask inconclusive.
# A probe that crashes or prints no status becomes "inconclusive" with its exit code and last error line, so the script can be fixed.
VERSION=2
say() { echo "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }
if has getprop && [ -n "$(getprop ro.build.version.sdk 2>/dev/null)" ]; then
  say "@ failed os-mismatch: This test is for Linux, but this phone is running Android. Select the installed Android ROM and start a new test."
  exit 1
fi
# t <feature> <probe function>: runs the probe in a subshell; keeps its last status line, else reports why it gave none.
t() {
  printf '\rROMinit: checking %-16s' "$1" >&2 # progress on the terminal; results go to stdout
  out=$( ( "$2" ) 2>&1 ); rc=$?
  line=$(printf '%s\n' "$out" | grep -E '^(full|partial|broken|blocked|untested|ask|inconclusive) ' | tail -n 1)
  if [ -n "$line" ]; then say "$1 $line"
  else say "$1 inconclusive probe $2 exit $rc: $(printf '%s' "$out" | tail -n 1 | tr -d '\r' | cut -c1-160)"; fi
}

say "@ script linux $VERSION"
echo "ROMinit: connected to the phone, running checks (a few seconds)..." >&2
# Right after boot, firmware-backed drivers (battery gauge, sound card via the DSP) are still loading: wait for boot to finish.
has systemctl && ! systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && { echo "ROMinit: phone still booting, waiting (up to 2 min)..." >&2; timeout 120 systemctl is-system-running --wait >/dev/null 2>&1; }
say "@ kernel $(uname -sr 2>&1)"
say "@ model $(tr -d "\0" 2>/dev/null < /proc/device-tree/model || cat /sys/class/dmi/id/product_name 2>/dev/null)"
say "@ os $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
for identity in /etc/deviceinfo /usr/share/deviceinfo/deviceinfo; do
  [ -r "$identity" ] || continue
  codename=$(sed -n 's/^deviceinfo_codename="\([a-z0-9_-]*\)"$/\1/p' "$identity" | head -n 1)
  [ -n "$codename" ] && { say "@ device $codename"; break; }
done
say "@debug uid $(id -u 2>&1) shell $(readlink /proc/$$/exe 2>&1)"
say "@debug tools $(for c in mmcli nmcli bluetoothctl speaker-test aplay fbcli fprintd-list lsblk ip; do has $c && printf '%s ' $c; done)"

inputs() { grep -iE "^N: Name=.*($1)" /proc/bus/input/devices 2>/dev/null | head -n 1 | cut -d'"' -f2; }
# iio <channel prefix>: first IIO device with that channel, e.g. in_accel_
iio() { for d in /sys/bus/iio/devices/iio:device*; do ls "$d" 2>/dev/null | grep -q "^$1" && { echo "$d"; return 0; }; done; return 1; }
iio_named() {
  for d in /sys/bus/iio/devices/iio:device*; do
    n=$(cat "$d/name" 2>/dev/null)
    printf '%s\n' "$n" | grep -qiE "$1" && { echo "$n"; return 0; }
  done
  return 1
}
sensor() { # sensor <channel prefix> <input-device pattern>
  if d=$(iio "$1"); then
    f=$(ls "$d" | grep -E "^$1.*(_raw|_input)$" | head -n 1)
    v=$(cat "$d/$f" 2>/dev/null) && echo "full $(cat "$d/name") reads $v" || echo "partial $(cat "$d/name") found, reading failed"
  elif n=$(inputs "$2") && [ -n "$n" ]; then echo "full input device $n"
  elif n=$(iio_named "$2"); then echo "partial $n registered; readable channels unavailable"
  else echo "broken no driver found"; fi
}

p_flashing() { echo "full booted this ROM"; }
p_root() {
  [ "$(id -u 2>/dev/null)" = 0 ] && { echo "available benchmark runs as uid 0"; return; }
  found= note=
  for tool in sudo doas; do
    has "$tool" || continue
    found="$found $tool"
    has timeout || { note="$note $tool found; timeout unavailable"; continue; }
    out=$(timeout 3 "$tool" -n id -u 2>&1); rc=$?
    [ "$rc" -eq 0 ] && [ "$(printf '%s' "$out" | tr -d '\r\n ')" = 0 ] && { echo "available $tool grants uid 0 without a password"; return; }
    if printf '%s' "$out" | grep -qiE '(authentication|password).*(required|needed)|(required|needed).*(authentication|password)'; then
      note="$note $tool requires interactive authentication"
    else note="$note $tool found; password-free root not verified"; fi
  done
  if [ -n "$found" ]; then echo "unverified$(printf '%s' "$note" | cut -c1-180)"
  elif has su; then echo "unverified su found; root access not checked"
  else echo "missing uid 0 and noninteractive sudo/doas not found; interactive root not tested"; fi
}
p_usb_net() {
  i=$(ls /sys/class/net | grep -E '^(usb|rndis|ncm)' | head -n 1)
  [ -n "$i" ] || { echo "broken no USB network interface"; return; }
  [ "$(cat "/sys/class/net/$i/operstate" 2>/dev/null)" = up ] && echo "full $i" || echo "partial $i present but down"
}
p_storage() {
  s=$(df -Pk / 2>/dev/null | awk 'NR==2 && $2 ~ /^[0-9]+$/ && $4 ~ /^[0-9]+$/ {print $2" KiB total, "$4" KiB free"; exit}')
  [ -n "$s" ] && echo "full $s" || echo "inconclusive storage capacity unavailable"
}
p_sdcard() {
  for b in /sys/block/mmcblk*; do [ "$(cat "$b/device/type" 2>/dev/null)" = SD ] && { echo "full ${b##*/} $(($(cat "$b/size") / 2097152)) GB"; return; }; done
  echo "blocked no SD card found; insert one to test"
}
p_battery() {
  for p in /sys/class/power_supply/*; do
    [ "$(cat "$p/type" 2>/dev/null)" = Battery ] || continue
    c=$(cat "$p/capacity" 2>/dev/null) && echo "full $c% $(cat "$p/status" 2>/dev/null)" || echo "partial ${p##*/} found, no charge level"
    return
  done
  echo "broken no battery driver"
}
p_screen() {
  evidence=
  for fb in /sys/class/graphics/fb[0-9]*; do
    [ -d "$fb" ] || continue
    mode=$(head -n 1 "$fb/modes" 2>/dev/null | cut -c1-80)
    depth=$(cat "$fb/bits_per_pixel" 2>/dev/null | tr -cd '0-9')
    evidence="${fb##*/}${mode:+ listed mode $mode}${depth:+ ${depth}bpp}"
    break
  done
  if [ -z "$evidence" ]; then
    for connector in /sys/class/drm/card*-*; do
      [ "$(cat "$connector/status" 2>/dev/null)" = connected ] || continue
      mode=$(head -n 1 "$connector/modes" 2>/dev/null | cut -c1-80)
      enabled=$(cat "$connector/enabled" 2>/dev/null)
      evidence="${connector##*/}${mode:+ listed mode $mode}${enabled:+ $enabled}"
      break
    done
  fi
  if [ -z "$evidence" ]; then
    if [ -e /dev/fb0 ] || ls /dev/dri/card* >/dev/null 2>&1; then
      echo "partial display device present; output state unavailable"
    else echo "inconclusive no readable framebuffer or connected DRM output; display not verified"; fi
    return
  fi
  for light in /sys/class/backlight/*; do
    [ -d "$light" ] || continue
    level=$(cat "$light/brightness" 2>/dev/null)
    maximum=$(cat "$light/max_brightness" 2>/dev/null)
    actual=$(cat "$light/actual_brightness" 2>/dev/null)
    power=$(cat "$light/bl_power" 2>/dev/null)
    case "$power" in 0) power="unblanked (0)" ;; 4) power="off (4)" ;; esac
    evidence="$evidence; backlight requested ${level:-unknown}/${maximum:-unknown}${actual:+ actual=$actual}${power:+ power=$power}"
    break
  done
  echo "ask Does the picture look right (colours, brightness, no flicker)? ($evidence; visual output not verified)"
}
# Capability bitmaps are hexadecimal, printed in machine-word groups on both 32/64-bit kernels.
input_bit() {
  awk -v bitmap="$1" -v bit="$2" 'BEGIN {
    gsub(/[[:space:]]/, "", bitmap); pos=length(bitmap)-int(bit/4)
    if (pos<1) exit 1
    digit=index("0123456789abcdef", tolower(substr(bitmap,pos,1)))-1
    exit !(digit>=0 && int(digit/(2^(bit%4)))%2)
  }'
}
p_touch() {
  for input in /sys/class/input/event*/device; do
    [ -d "$input" ] || continue
    properties=$(cat "$input/properties" 2>/dev/null)
    absolute=$(cat "$input/capabilities/abs" 2>/dev/null)
    axes=
    if input_bit "$absolute" 53 && input_bit "$absolute" 54; then axes="multitouch XY"
    elif input_bit "$absolute" 0 && input_bit "$absolute" 1; then axes="absolute XY"; fi
    # Direct input is a screen; legacy multitouch without the pointer property is also a candidate.
    if ! input_bit "$properties" 1; then
      [ "$axes" = "multitouch XY" ] && ! input_bit "$properties" 0 || continue
      axes="$axes, legacy touch candidate"
    fi
    name=$(cat "$input/name" 2>/dev/null | head -n 1 | cut -c1-80)
    event=${input%/device}; event=${event##*/}
    access="event access requires permission"
    [ -r "/dev/input/$event" ] && access="event node readable"
    if [ -z "$axes" ]; then
      echo "partial ${name:-$event} direct input registered; XY capabilities unavailable"
    else echo "ask Does touch follow your finger everywhere, including edges? (${name:-$event}; $axes; $access; events not sampled)"; fi
    return
  done
  echo "inconclusive no readable direct-touch capabilities; touchscreen not verified"
}

gpu_probe() { timeout 5 "$@" 2>/dev/null | head -c 32768; }
gpu_renderer() {
  case "$1" in
    glxinfo) r=$(gpu_probe glxinfo -B | sed -n 's/^[[:space:]]*OpenGL renderer string:[[:space:]]*//p') ;;
    eglinfo) r=$(gpu_probe eglinfo -B | sed -n 's/^[[:space:]]*GL_RENDERER:[[:space:]]*//p') ;;
    *) return 1 ;;
  esac
  r=$(printf '%s\n' "$r" | tr -d '\r' | grep -ivE 'llvmpipe|softpipe|swiftshader|lavapipe|software|unknown|unavailable|none' | head -n 1 | cut -c1-120)
  [ -n "$r" ] || return 1
  printf '%s: %s' "$1" "$r"
}
gpu_vulkan_device() {
  gpu_probe vulkaninfo --summary | sed -n 's/^[[:space:]]*deviceName[[:space:]]*=[[:space:]]*//p' | tr -d '\r' | grep -ivE 'llvmpipe|softpipe|swiftshader|lavapipe|software|unknown|unavailable|none' | head -n 1 | cut -c1-120
}
p_gpu() {
  if has timeout; then
    for tool in glxinfo eglinfo; do
      has "$tool" || continue
      r=$(gpu_renderer "$tool") && { echo "full hardware renderer via $r"; return; }
    done
    if has vulkaninfo; then
      r=$(gpu_vulkan_device) && [ -n "$r" ] && { echo "partial GPU device detected (vulkaninfo: $r); acceleration not verified"; return; }
    fi
  fi
  for d in /dev/dri/renderD* /dev/mali* /dev/kgsl-3d*; do
    [ -e "$d" ] && { echo "partial GPU device detected; acceleration not verified"; return; }
  done
  echo "broken no GPU device or verified renderer"
}
p_audio() {
  cards=$(cat /proc/asound/cards 2>/dev/null); cards_rc=$?
  pcm=$(cat /proc/asound/pcm 2>/dev/null); pcm_rc=$?
  card_count=$(printf '%s\n' "$cards" | awk '/^[[:space:]]*[0-9]+[[:space:]]+\[/ {n++} END {print n+0}')
  play_nodes=0; play_access=0; capture_nodes=0; capture_access=0
  for d in /dev/snd/pcmC*D*p; do [ -e "$d" ] || continue; play_nodes=$((play_nodes + 1)); [ -w "$d" ] && play_access=$((play_access + 1)); done
  for d in /dev/snd/pcmC*D*c; do [ -e "$d" ] || continue; capture_nodes=$((capture_nodes + 1)); [ -r "$d" ] && capture_access=$((capture_access + 1)); done
  if [ "$pcm_rc" -eq 0 ]; then
    playback=$(printf '%s\n' "$pcm" | awk 'tolower($0) ~ /playback[[:space:]]+[1-9][0-9]*/ {n++} END {print n+0}')
    capture=$(printf '%s\n' "$pcm" | awk 'tolower($0) ~ /capture[[:space:]]+[1-9][0-9]*/ {n++} END {print n+0}')
    [ "$play_nodes" -gt "$playback" ] && playback=$play_nodes
    [ "$capture_nodes" -gt "$capture" ] && capture=$capture_nodes
  else playback=$play_nodes; capture=$capture_nodes; fi
  permission=''
  if [ "$play_nodes" -gt 0 ] && [ "$play_access" -lt "$play_nodes" ]; then
    if [ "$play_access" -eq 0 ]; then permission='; playback PCM nodes are not writable by this user'
    else permission='; some playback PCM nodes are not writable'; fi
  fi
  if [ "$capture_nodes" -gt 0 ] && [ "$capture_access" -lt "$capture_nodes" ]; then
    if [ "$capture_access" -eq 0 ]; then permission="$permission; capture PCM nodes are not readable by this user"
    else permission="$permission; some capture PCM nodes are not readable"; fi
  elif [ "$play_nodes" -eq 0 ] && [ "$capture_nodes" -eq 0 ] && [ -d /dev/snd ] && [ ! -r /dev/snd ]; then permission='; /dev/snd directory is not readable by this user'
  fi
  if [ "$playback" -eq 0 ]; then
    if [ "$capture" -gt 0 ]; then
      echo "partial ALSA playback 0, capture $capture; capture-only, speaker output unverified$permission"
    elif [ "$cards_rc" -eq 0 ] && [ "$card_count" -gt 0 ] && [ "$pcm_rc" -eq 0 ]; then echo "partial ALSA card $card_count; no playback/capture PCM devices"
    else echo "inconclusive ALSA audio inventory unavailable$permission"; fi
    return
  fi
  if [ "$play_nodes" -gt 0 ] && [ "$play_access" -eq 0 ]; then
    echo "partial ALSA playback $playback, capture $capture$permission"
    return
  fi
  if [ "$ROMINIT_SOUND" = 1 ]; then
    if has timeout && has speaker-test; then
      timeout 3 speaker-test -t sine -f 660 -l 1 >/dev/null 2>&1; tone_rc=$?
      if [ "$tone_rc" -eq 0 ]; then echo "ask ALSA playback $playback, capture $capture; did you hear the short speaker-test tone?$permission"
      elif [ "$tone_rc" -eq 124 ]; then echo "ask ALSA playback $playback, capture $capture; tone check stopped after 3 seconds; did you hear anything?$permission"
      else echo "ask ALSA playback $playback, capture $capture; opted-in tone check failed, play a sound and confirm it is audible$permission"; fi
    else echo "ask ALSA playback $playback, capture $capture; timeout or speaker-test unavailable, play a sound and confirm it is audible$permission"; fi
  else echo "ask ALSA playback $playback, capture $capture; play a sound and confirm the speaker is audible$permission"; fi
}
p_camera() {
  n=$(cat /sys/class/video4linux/*/name 2>/dev/null | grep -viE 'venus|vidc|codec|enc|dec|jpeg|isp|csiphy|csid|vfe' | head -n 1)
  [ -n "$n" ] && echo "ask Open the camera app: do you see a picture? ($n)" || echo "broken no camera driver"
}
p_camera_flash() { l=$(ls /sys/class/leds 2>/dev/null | grep -iE 'flash|torch' | head -n 1); [ -n "$l" ] && echo "full LED $l" || echo "broken no flash LED driver"; }
p_ir() { ls /dev/lirc* /sys/class/rc/* >/dev/null 2>&1 && echo "full IR device found" || echo "broken no IR driver"; }
p_wifi() {
  i=$(ls /sys/class/net | grep -E '^wl' | head -n 1)
  [ -z "$i" ] && { echo "broken no Wi-Fi interface"; return; }
  [ "$(cat /sys/class/net/$i/operstate)" = up ] && { echo "full $i connected"; return; }
  n=$(has nmcli && nmcli -t -f SSID dev wifi list 2>/dev/null | grep -c .)
  [ "${n:-0}" -gt 0 ] && echo "full $i sees $n networks" || echo "partial $i found, sees no networks"
}
p_bluetooth() { ls /sys/class/bluetooth/hci* >/dev/null 2>&1 && echo "full $(ls /sys/class/bluetooth | head -n 1)" || echo "broken no Bluetooth adapter"; }
modem() { has mmcli && mmcli -L 2>/dev/null | grep -o '/Modem/[0-9]*' | head -n 1 | cut -d/ -f3; }
mstate() { mmcli -m "$1" -K 2>/dev/null | grep -E "^$2 " | head -n 1 | cut -d: -f2- | tr -d ' '; }
p_gps() {
  ls /dev/gnss* >/dev/null 2>&1 && { echo "full GNSS device found (fix needs sky view)"; return; }
  m=$(modem); [ -n "$m" ] && echo "untested modem $m may provide GPS; needs sky view" || echo "broken no GNSS device"
}
p_nfc() { ls /sys/class/nfc/* >/dev/null 2>&1 && echo "full NFC adapter found" || echo "broken no NFC driver"; }
cellular() { # cellular <what>
  has mmcli || { ls /dev/wwan* /sys/class/net/rmnet* >/dev/null 2>&1 && echo "partial modem device found, no ModemManager" || echo "broken no modem found"; return; }
  m=$(modem); [ -z "$m" ] && { echo "broken ModemManager sees no modem"; return; }
  s=$(mstate "$m" modem.generic.state); r=$(mstate "$m" modem.generic.state-failed-reason)
  [ "$r" = sim-missing ] && { echo "blocked insert a SIM to test"; return; }
  case "$1:$s" in
    data:connected) echo "full mobile data connected" ;;
    *:registered|*:connected) echo "full modem registered" ;;
    *) echo "partial modem state $s${r:+ ($r)}" ;;
  esac
}
p_calls() { cellular calls; }
p_sms() { cellular sms; }
p_data() { cellular data; }
p_fde() { ls /dev/mapper 2>/dev/null | grep -qv control && echo "full encrypted volume open" || echo "untested root not encrypted"; }
p_otg() { echo "blocked plug in a USB stick through an OTG adapter to test"; }
p_hdmi() { ls /sys/class/drm 2>/dev/null | grep -qiE 'HDMI|DP-' && echo "blocked plug in a display to test" || echo "untested no HDMI/DP output found"; }
p_fingerprint() { has fprintd-list && echo "untested fprintd installed; enrol a finger to test" || echo "untested no fingerprint service"; }
p_accelerometer() { sensor in_accel_ 'accel|bma|lsm|lis3|mpu'; }
p_magnetometer() { sensor in_magn_ 'magn|compass|ak09|ak89|mmc'; }
p_light() { sensor in_illuminance 'light|als'; }
p_proximity() { sensor in_proximity 'prox'; }
p_barometer() { sensor in_pressure 'press|bmp|lps'; }
p_hall() { n=$(inputs 'hall|lid|cover'); [ -n "$n" ] && echo "full $n" || echo "broken no hall sensor input"; }
p_haptics() {
  vibrator=/sys/class/timed_output/vibrator/enable
  grep -q 'B: FF=.*[1-9a-fA-F]' /proc/bus/input/devices 2>/dev/null || [ -e "$vibrator" ] || [ -d /sys/class/leds/vibrator ] || { echo "inconclusive no vibrator interface detected"; return; }
  if [ "$ROMINIT_SOUND" != 1 ]; then echo "ask Vibrator interface found; does vibration work?"; return; fi
  if has timeout && has fbcli; then
    if timeout 3 fbcli -t 1 -E button-pressed >/dev/null 2>&1; then echo "ask Did the phone just buzz?"
    else echo "ask Vibration command failed; does vibration work manually?"; fi
  elif [ -e "$vibrator" ]; then
    if [ ! -w "$vibrator" ]; then echo "blocked Vibrator found; this user cannot write its control"
    elif (printf '200\n' > "$vibrator") 2>/dev/null; then echo "ask Did the phone just buzz?"
    else echo "ask Vibration control failed; does vibration work manually?"; fi
  else echo "ask Vibrator interface found; no supported vibration command available"; fi
}

for f in flashing usb_net storage sdcard battery screen touch gpu audio camera camera_flash ir wifi bluetooth gps nfc calls sms data \
  fde otg hdmi fingerprint accelerometer magnetometer light proximity hall haptics barometer; do t "$f" "p_$f"; done
say "@root $(p_root)"
# Installed packages, so the page can tell what the ROM ships (SSH, Docker, phone UI…).
say "@pkgs $( { apk info 2>/dev/null || dpkg-query -W -f '${Package}\n' 2>/dev/null || pacman -Qq 2>/dev/null; } | tr '\n' ' ')"
say "@ done"
printf '\rROMinit: all checks done, sending results...\n' >&2
