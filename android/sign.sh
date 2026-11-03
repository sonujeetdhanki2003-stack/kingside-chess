#!/bin/sh
# Sign the release APK. The keystore and its password are NOT in this repo.
# Usage: KS=/path/to/release.keystore KS_PASS=... android/sign.sh
set -e
: "${KS:?set KS to the release keystore path}"
: "${KS_PASS:?set KS_PASS to the keystore password}"
BT=${ANDROID_HOME:-/opt/android/sdk}/build-tools/36.1.0
cd "$(dirname "$0")/build"
export KS_PASS
$BT/apksigner sign --ks "$KS" --ks-key-alias kingside --ks-pass env:KS_PASS --key-pass env:KS_PASS --out KingsideChess.apk aligned.apk
$BT/apksigner verify --verbose --print-certs KingsideChess.apk | head -12
