
set -e
export ANDROID_HOME=/opt/android/sdk
BT=$ANDROID_HOME/build-tools/36.1.0
JAR=$ANDROID_HOME/platforms/android-36/android.jar
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/res build/gen build/classes build/dex
$BT/aapt2 compile --dir res -o build/res/
$BT/aapt2 link -o build/unaligned-nodex.apk -I $JAR --manifest AndroidManifest.xml -A assets \
  --min-sdk-version 24 --target-sdk-version 36 --version-code 13 --version-name 1.9.0 \
  --java build/gen --no-version-vectors build/res/*.flat
javac -source 11 -target 11 -Xlint:-options -encoding UTF-8 -cp $JAR -d build/classes $(find src build/gen -name '*.java')
$BT/d8 --release --min-api 24 --lib $JAR --output build/dex $(find build/classes -name '*.class')
cp build/unaligned-nodex.apk build/unaligned.apk
(cd build/dex && zip -q -X ../unaligned.apk classes.dex)
$BT/zipalign -f -p 4 build/unaligned.apk build/aligned.apk
echo BUILD_OK
ls -la build/*.apk
