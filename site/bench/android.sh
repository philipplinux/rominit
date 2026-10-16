#!/system/bin/sh
# ROMinit phone test for Android ROMs (LineageOS, stock). Best over `adb shell`; a terminal app lacks the permissions for most probes.
# Reads only, changes nothing, silent; the buzz check only runs when the user opts in with ROMINIT_SOUND=1.
# Output, one line each: "<feature> <status> <note>". Status: full partial broken blocked untested ask inconclusive.
# A probe that crashes or prints no status becomes "inconclusive" with its exit code and last error line, so the script can be fixed.
VERSION=1
say() { echo "$*"; }
has() { command -v "$1" >/dev/null 2>&1; }
t() {
  printf '\rROMinit: checking %-16s' "$1" >&2 # progress on the terminal; results go to stdout
  out=$( ( "$2" ) 2>&1 ); rc=$?
  line=$(printf '%s\n' "$out" | grep -E '^(full|partial|broken|blocked|untested|ask) ' | tail -n 1)
  if [ -n "$line" ]; then say "$1 $line"
  else say "$1 inconclusive probe $2 exit $rc: $(printf '%s' "$out" | tail -n 1 | tr -d '\r' | cut -c1-160)"; fi
}

FEATURES_LIST=$(pm list features 2>/dev/null)
SENSORS=$(dumpsys sensorservice 2>/dev/null | sed -n '1,/^$/p;/Sensor List/,/^$/p')
say "@ script android $VERSION"
echo "ROMinit: connected to the phone, running checks (a few seconds)..." >&2
say "@ kernel $(uname -sr 2>&1)"
say "@ model $(getprop ro.product.manufacturer) $(getprop ro.product.model) ($(getprop ro.product.device))"
say "@ os $(getprop ro.build.display.id) Android $(getprop ro.build.version.release)"
say "@debug user $(id -un 2>&1) sdk $(getprop ro.build.version.sdk) features $(printf '%s\n' "$FEATURES_LIST" | grep -c feature:) sensors-lines $(printf '%s\n' "$SENSORS" | wc -l)"
say "@debug tools $(for c in pm dumpsys cmd settings getprop sm df ip; do has $c && printf '%s ' $c; done)"

feat() { printf '%s\n' "$FEATURES_LIST" | grep -q "^feature:android.hardware.$1\$"; }
need_pm() { [ -n "$FEATURES_LIST" ] || { echo "probe needs pm (run through adb shell)" >&2; exit 3; }; }
sensor() { # sensor <hardware feature> <sensor list pattern>
  [ -n "$SENSORS" ] || { echo "dumpsys sensorservice gave nothing (run through adb shell)" >&2; exit 3; }
  n=$(printf '%s\n' "$SENSORS" | grep -iE "$2" | head -n 1 | cut -c1-60)
  if [ -n "$n" ]; then echo "full listed: $n"; elif feat "$1"; then echo "partial declared but not listed"; else echo "broken not listed"; fi
}

p_flashing() { echo "full booted this ROM"; }
p_usb_net() { echo "untested USB tethering: turn it on to test"; }
p_storage() { s=$(df -h /data | tail -n 1 | awk '{print $2" total, "$4" free"}'); [ -n "$s" ] && echo "full $s"; }
p_sdcard() { v=$(sm list-volumes public 2>/dev/null | grep -m1 mounted); [ -n "$v" ] && echo "full $v" || echo "blocked no SD card found; insert one to test"; }
p_battery() { l=$(dumpsys battery | grep -m1 ' level:' | tr -dc 0-9); [ -n "$l" ] && echo "full $l%" || echo "broken no battery level"; }
p_screen() { echo "ask Does the picture look right (colours, brightness, no flicker)?"; }
p_touch() { need_pm; feat touchscreen && echo "ask Does touch follow your finger everywhere, edges too?" || echo "broken no touchscreen declared"; }
p_gpu() { g=$(dumpsys SurfaceFlinger | grep -m1 'GLES:' | cut -c1-100); case "$g" in *[Ss]wift[Ss]hader*|*llvmpipe*|'') echo "broken software rendering ${g:-unknown}" ;; *) echo "full $g" ;; esac; }
p_audio() { dumpsys media.audio_flinger | grep -q 'Output thread' && echo "ask Play any sound: does the speaker work?" || echo "broken no audio output"; }
p_camera() { n=$(dumpsys media.camera | grep -m1 'Number of camera devices' | tr -dc 0-9); [ "${n:-0}" -gt 0 ] && echo "ask Open the camera app: do you see a picture? ($n cameras)" || echo "broken no camera"; }
p_camera_flash() { need_pm; feat camera.flash && echo "untested flash declared" || echo "broken no flash declared"; }
p_ir() { need_pm; feat consumerir && echo "untested IR blaster declared" || echo "broken no IR declared"; }
p_wifi() {
  need_pm; feat wifi || { echo "broken no Wi-Fi"; return; }
  ip addr show wlan0 2>/dev/null | grep -q 'inet ' && echo "full wlan0 connected" || echo "partial Wi-Fi present, not connected"
}
p_bluetooth() { need_pm; feat bluetooth || { echo "broken no Bluetooth"; return; }; [ "$(settings get global bluetooth_on)" = 1 ] && echo "full on" || echo "partial present, switched off"; }
p_gps() { need_pm; feat location.gps || { echo "broken no GPS declared"; return; }
  dumpsys location 2>/dev/null | grep -qE 'last location=Location\[gps|gps: Location\[gps' && echo "full has a GPS fix" || echo "untested GPS declared; open a maps app outdoors, then run again"; }
p_nfc() { need_pm; feat nfc || { echo "broken no NFC declared"; return; }
  case "$(dumpsys nfc 2>/dev/null | grep -m1 -oE 'mState=[a-z_]+')" in mState=on) echo "full NFC controller on (tag reading not tested)";;
    mState=off) echo "untested NFC is off: turn it on, then run again";; *) echo "untested NFC declared";; esac; }
cellular() {
  need_pm; feat telephony || { echo "broken no telephony"; return; }
  case "$(getprop gsm.sim.state)" in
    *ABSENT*|'') echo "blocked insert a SIM to test" ;;
    *READY*|*LOADED*) if [ "$1" = data ] && dumpsys telephony.registry | grep -q 'mDataConnectionState=2'; then echo "full mobile data connected"
      else echo "untested SIM ready; $1 needs a real try"; fi ;;
    *) echo "partial SIM state $(getprop gsm.sim.state)" ;;
  esac
}
p_calls() { cellular calls; }
p_sms() { cellular sms; }
p_data() { cellular data; }
p_fde() { s=$(getprop ro.crypto.state); [ "$s" = encrypted ] && echo "full encrypted ($(getprop ro.crypto.type))" || echo "untested crypto state ${s:-unknown}"; }
p_otg() { need_pm; feat usb.host && echo "blocked plug in a USB stick through an OTG adapter to test" || echo "broken no USB host declared"; }
p_hdmi() { echo "untested needs a display adapter"; }
p_fingerprint() { need_pm; feat fingerprint && echo "untested sensor declared; enrol a finger to test" || echo "broken no fingerprint declared"; }
p_accelerometer() { sensor sensor.accelerometer 'accelerometer'; }
p_magnetometer() { sensor sensor.compass 'magnetic|magnetometer'; }
p_light() { sensor sensor.light 'light'; }
p_proximity() { sensor sensor.proximity 'proximity'; }
p_barometer() { sensor sensor.barometer 'pressure|barometer'; }
p_hall() { # often an input switch (SW_LID), not a sensor
  printf '%s\n' "$SENSORS" | grep -qiE 'hall|cover' && { echo "full listed as sensor"; return; }
  getevent -pl 2>/dev/null | grep -q SW_LID && echo "full cover switch (SW_LID)" || echo "untested no hall sensor or cover switch found"; }
p_haptics() {
  dumpsys vibrator_manager 2>/dev/null | grep -qiE 'vibrator|hal' || dumpsys vibrator 2>/dev/null | grep -qi vibrat || { echo "broken no vibrator service"; return; }
  if [ "$ROMINIT_SOUND" = 1 ]; then cmd vibrator_manager synced oneshot 300 >/dev/null 2>&1 || cmd vibrator vibrate 300 >/dev/null 2>&1; echo "ask Did the phone just buzz?"; else echo "untested vibrator found"; fi
}

for f in flashing usb_net storage sdcard battery screen touch gpu audio camera camera_flash ir wifi bluetooth gps nfc calls sms data \
  fde otg hdmi fingerprint accelerometer magnetometer light proximity hall haptics barometer; do t "$f" "p_$f"; done
# Installed packages, so the page can tell what the ROM ships (Google Play, microG, root…).
say "@pkgs $(pm list packages 2>/dev/null | sed 's/^package://' | tr '\n' ' ')"
say "@ done"
printf '\rROMinit: all checks done, sending results...\n' >&2
