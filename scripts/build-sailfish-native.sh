#!/usr/bin/env bash
# Native aarch64 build of FiTerm for Sailfish OS
#
#   bash scripts/build-sailfish-native.sh                 # build + package RPM
#   bash scripts/build-sailfish-native.sh --compile       # compile only
#   bash scripts/build-sailfish-native.sh --prepare       # regenerate sources first
#   bash scripts/build-sailfish-native.sh --prepare-only  # regenerate + patch only
#   JOBS=2 bash scripts/build-sailfish-native.sh          # limit parallelism
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="aarch64"
MODE="rpm"
JOBS="${JOBS:-2}"
PREPARE=0

export CFLAGS="${CFLAGS:--O2 -g0}"
export CXXFLAGS="${CXXFLAGS:--O2 -g0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --compile|--compile-only) MODE="compile" ;;
    --prepare) PREPARE=1 ;;
    --prepare-only) PREPARE=1; MODE="prepare" ;;
    -j[0-9]*) JOBS="${1#-j}" ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if ! command -v node >/dev/null 2>&1; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v22*/bin 2>/dev/null | sort -V | tail -n 1)"
  if [ -z "$NODE_BIN" ]; then
    NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -n 1)"
  fi
  if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN/node" ]; then
    export PATH="$NODE_BIN:$PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js or add it to PATH." >&2
  exit 1
fi

STAGE="$ROOT/.gea-sailfish/build/fiterm-$ARCH/project"

if [ "$PREPARE" = 1 ] || [ ! -d "$STAGE" ]; then
  echo "==> Preparing GeaStack Sailfish sources and stage"
  GEA_RPIOS_FONT_LATIN_EXTENDED=1 node vendor/geastack-linux/targets/sailfish-os/prepare.mjs "$ROOT" "$ARCH"
fi

echo "==> Applying FiTerm Sailfish stage patches"
node patches/geastack-sailfish-build.mjs "$STAGE"

if [ ! -f "$STAGE/CMakeLists.txt" ]; then
  echo "Missing prepared stage: $STAGE" >&2
  exit 1
fi

if [ "$MODE" = "prepare" ]; then
  echo "==> Sailfish stage prepared successfully at: $STAGE"
  exit 0
fi

if [ "$MODE" = "compile" ]; then
  echo "==> Configuring (ninja, -j$JOBS)"
  cmake -S "$STAGE" -B "$STAGE/build" -G Ninja -DCMAKE_BUILD_TYPE=Release
  echo "==> Compiling"
  cmake --build "$STAGE/build" -j "$JOBS"
  echo "==> Binary compiled successfully at: $STAGE/build/harbour-gea-fiterm"
  exit 0
fi

SPEC="$(ls "$STAGE"/rpm/*.spec)"
NAME="$(awk '/^Name:/{print $2; exit}' "$SPEC")"
VERSION="$(awk '/^Version:/{print $2; exit}' "$SPEC")"
TOPDIR="${RPM_TOPDIR:-$ROOT/.gea-sailfish/build/fiterm-$ARCH/rpmbuild}"
WORKDIR="$TOPDIR/BUILD/$NAME-$VERSION"

echo "==> Packaging $NAME-$VERSION (rpmbuild, -j$JOBS)"
rm -rf "$TOPDIR"
mkdir -p "$TOPDIR/BUILD" "$TOPDIR/BUILDROOT" "$TOPDIR/RPMS" "$TOPDIR/SOURCES" "$TOPDIR/SPECS" "$TOPDIR/SRPMS"
cp -a "$STAGE" "$WORKDIR"

BRP_STATIC_DEFINE=""
if ! xargs --version 2>/dev/null | grep -q 'GNU'; then
  echo "==> BusyBox xargs detected; skipping brp-strip-static-archive"
  BRP_STATIC_DEFINE="__brp_strip_static_archive %{nil}"
fi

rpmbuild \
  -bb \
  --define "_topdir $TOPDIR" \
  --define "_builddir $TOPDIR/BUILD/$NAME-$VERSION" \
  --define "_smp_mflags -j$JOBS" \
  ${BRP_STATIC_DEFINE:+--define "$BRP_STATIC_DEFINE"} \
  "$SPEC"

RPM_PATH="$(ls "$TOPDIR"/RPMS/*/"$NAME"-"$VERSION"-*.rpm | head -n 1)"
OUT_DIR="$ROOT/.gea-sailfish/dist"
mkdir -p "$OUT_DIR"
cp "$RPM_PATH" "$OUT_DIR/"

echo "==> RPM built successfully: $OUT_DIR/$(basename "$RPM_PATH")"
