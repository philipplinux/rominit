#!/bin/sh
# ROMinit phone test for Linux ROMs (postmarketOS and friends). Reads only, changes nothing, silent.
# Tone and buzz checks only run when the user opts in with ROMINIT_SOUND=1.
# Output, one line each: "<feature> <status> <note>". Status: full partial broken blocked untested ask inconclusive.
# A probe that crashes or prints no status becomes "inconclusive" with its exit code and last error line, so the script can be fixed.
VERSION=1
say() { echo "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }
# t <feature> <probe function>: runs the probe in a subshell; keeps its last status line, else reports why it gave none.
t() {
  printf '\rROMinit: checking %-16s' "$1" >&2 # progress on the terminal; results go to stdout
  out=$( ( "$2" ) 2>&1 ); rc=$?
  line=$(printf '%s\n' "$out" | grep -E '^(full|partial|broken|blocked|untested|ask) ' | tail -n 1)
  if [ -n "$line" ]; then say "$1 $line"
  else say "$1 inconclusive probe $2 exit $rc: $(printf '%s' "$out" | tail -n 1 | tr -d '\r' | cut -c1-160)"; fi
}

say "@ script linux $VERSION"
echo "ROMinit: connected to the phone, running checks (a few seconds)..." >&2
say "@ kernel $(uname -sr 2>&1)"
say "@ model $(tr -d "\0" 2>/dev/null < /proc/device-tree/model || cat /sys/class/dmi/id/product_name 2>/dev/null)"
say "@ os $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
say "@debug user $(id -un 2>&1) shell $(readlink /proc/$$/exe 2>&1)"
say "@debug tools $(for c in mmcli nmcli bluetoothctl speaker-test aplay fbcli fprintd-list lsblk ip; do has $c && printf '%s ' $c; done)"

inputs() { grep -iE "^N: Name=.*($1)" /proc/bus/input/devices 2>/dev/null | head -n 1 | cut -d'"' -f2; }
# iio <channel prefix>: first IIO device with that channel, e.g. in_accel_
iio() { for d in /sys/bus/iio/devices/iio:device*; do ls "$d" 2>/dev/null | grep -q "^$1" && { echo "$d"; return 0; }; done; return 1; }
sensor() { # sensor <channel prefix> <input-device pattern>
  if d=$(iio "$1"); then
    f=$(ls "$d" | grep -E "^$1.*(_raw|_input)$" | head -n 1)
    v=$(cat "$d/$f" 2>/dev/null) && echo "full $(cat "$d/name") reads $v" || echo "partial $(cat "$d/name") found, reading failed"
  elif n=$(inputs "$2") && [ -n "$n" ]; then echo "partial input device $n"
  else echo "broken no driver found"; fi
}

p_flashing() { echo "full booted this ROM"; }
p_usb_net() { i=$(ls /sys/class/net | grep -E '^(usb|rndis)' | head -n 1); [ -n "$i" ] && echo "full $i" || echo "broken no USB network interface"; }
p_storage() { s=$(df -h / | tail -n 1 | awk '{print $2" total, "$4" free"}'); touch /tmp/.rominit && rm /tmp/.rominit && echo "full $s"; }
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
p_screen() { { ls /dev/dri 2>/dev/null | grep -q card || [ -e /dev/fb0 ]; } && echo "ask Does the picture look right (colours, brightness, no flicker)?" || echo "broken no display device"; }
p_touch() { # INPUT_PROP_DIRECT (PROP=2) marks a touchscreen whatever the driver is called
  n=$(awk -F'"' '/^N: Name=/{n=$2} /^B: PROP=.*[2367abef]$/{print n; exit}' /proc/bus/input/devices 2>/dev/null)
  [ -n "$n" ] || n=$(inputs 'touch|_ts|-ts|synaptics|fts|ft5|goodix|novatek|himax|ilitek|sec_')
  [ -n "$n" ] && echo "ask Does touch follow your finger everywhere, edges too? ($n)" || echo "broken no touchscreen input"
}
p_gpu() {
  r=$(ls /dev/dri/ 2>/dev/null | grep renderD | head -n 1)
  [ -n "$r" ] && echo "full $(basename "$(readlink /sys/class/drm/$r/device/driver)")" || echo "broken no GPU driver, software rendering"
}
p_audio() {
  grep -q '^ *[0-9]' /proc/asound/cards 2>/dev/null || { echo "broken no sound card"; return; }
  if [ "$ROMINIT_SOUND" = 1 ] && has speaker-test; then timeout 3 speaker-test -t sine -f 660 -l 1 >/dev/null 2>&1; echo "ask Did you just hear a short tone from the speaker?"
  else echo "ask Play any sound: does the speaker work?"; fi
}
p_camera() {
  n=$(cat /sys/class/video4linux/*/name 2>/dev/null | grep -viE 'venus|vidc|codec|enc|dec|jpeg|isp|csiphy|csid|vfe' | head -n 1)
  [ -n "$n" ] && echo "ask Open the camera app: do you see a picture? ($n)" || echo "broken no camera driver"
}
p_camera_flash() { l=$(ls /sys/class/leds 2>/dev/null | grep -iE 'flash|torch' | head -n 1); [ -n "$l" ] && echo "untested LED $l found" || echo "broken no flash LED driver"; }
p_ir() { ls /dev/lirc* /sys/class/rc/* >/dev/null 2>&1 && echo "untested IR device found" || echo "broken no IR driver"; }
p_wifi() {
  i=$(ls /sys/class/net | grep -E '^wl' | head -n 1)
  [ -z "$i" ] && { echo "broken no Wi-Fi interface"; return; }
  [ "$(cat /sys/class/net/$i/operstate)" = up ] && echo "full $i connected" || echo "partial $i found, not connected"
}
p_bluetooth() { ls /sys/class/bluetooth/hci* >/dev/null 2>&1 && echo "full $(ls /sys/class/bluetooth | head -n 1)" || echo "broken no Bluetooth adapter"; }
modem() { has mmcli && mmcli -L 2>/dev/null | grep -o '/Modem/[0-9]*' | head -n 1 | cut -d/ -f3; }
mstate() { mmcli -m "$1" -K 2>/dev/null | grep -E "^$2 " | head -n 1 | cut -d: -f2- | tr -d ' '; }
p_gps() {
  ls /dev/gnss* >/dev/null 2>&1 && { echo "untested GNSS device found; needs sky view"; return; }
  m=$(modem); [ -n "$m" ] && echo "untested modem $m may provide GPS; needs sky view" || echo "broken no GNSS device"
}
p_nfc() { ls /sys/class/nfc/* >/dev/null 2>&1 && echo "untested NFC adapter found" || echo "broken no NFC driver"; }
cellular() { # cellular <what>
  has mmcli || { ls /dev/wwan* /sys/class/net/rmnet* >/dev/null 2>&1 && echo "untested modem device found, no ModemManager" || echo "broken no modem found"; return; }
  m=$(modem); [ -z "$m" ] && { echo "broken ModemManager sees no modem"; return; }
  s=$(mstate "$m" modem.generic.state); r=$(mstate "$m" modem.generic.state-failed-reason)
  [ "$r" = sim-missing ] && { echo "blocked insert a SIM to test"; return; }
  case "$1:$s" in
    data:connected) echo "full mobile data connected" ;;
    *:registered|*:connected) echo "untested modem registered; $1 needs a real try" ;;
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
p_hall() { n=$(inputs 'hall|lid|cover'); [ -n "$n" ] && echo "untested $n found; close a cover to test" || echo "broken no hall sensor input"; }
p_haptics() {
  grep -q 'B: FF=' /proc/bus/input/devices 2>/dev/null || ls /sys/class/leds/vibrator >/dev/null 2>&1 || { echo "broken no vibrator driver"; return; }
  if [ "$ROMINIT_SOUND" = 1 ] && has fbcli; then timeout 3 fbcli -t 1 -E button-pressed >/dev/null 2>&1; echo "ask Did the phone just buzz?"; else echo "untested vibrator found"; fi
}

for f in flashing usb_net storage sdcard battery screen touch gpu audio camera camera_flash ir wifi bluetooth gps nfc calls sms data \
  fde otg hdmi fingerprint accelerometer magnetometer light proximity hall haptics barometer; do t "$f" "p_$f"; done
# Installed packages, so the page can tell what the ROM ships (SSH, Docker, phone UI…).
say "@pkgs $( { apk info 2>/dev/null || dpkg-query -W -f '${Package}\n' 2>/dev/null || pacman -Qq 2>/dev/null; } | tr '\n' ' ')"
say "@ done"
printf '\rROMinit: all checks done, sending results...\n' >&2
