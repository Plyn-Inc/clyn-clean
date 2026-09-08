#!/bin/bash
# =========================================================
# 입주청소 예약센터 DB 백업 스크립트
#
# 사용법:
#   chmod +x scripts/backup-db.sh
#   ./scripts/backup-db.sh
#
# 자동 실행 (crontab - 매일 새벽 2시):
#   0 2 * * * /path/to/project/scripts/backup-db.sh >> /var/log/cleaning-backup.log 2>&1
# =========================================================

DB_PATH="${DATABASE_PATH:-/data/cleaning-reservation.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cleaning-reservation-${DATE}.db"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] DB 백업 시작"
echo "  원본: ${DB_PATH}"
echo "  대상: ${BACKUP_FILE}"

# 백업 디렉토리 생성
mkdir -p "${BACKUP_DIR}"

# DB 파일 존재 확인
if [ ! -f "${DB_PATH}" ]; then
  echo "[ERROR] DB 파일을 찾을 수 없습니다: ${DB_PATH}"
  exit 1
fi

# SQLite WAL 체크포인트 후 복사 (sqlite3 CLI 사용 가능한 경우)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "${DB_PATH}" "PRAGMA wal_checkpoint(FULL);" > /dev/null 2>&1
fi

# DB 파일 복사 (WAL 파일도 함께)
cp "${DB_PATH}" "${BACKUP_FILE}"
[ -f "${DB_PATH}-shm" ] && cp "${DB_PATH}-shm" "${BACKUP_FILE}-shm"
[ -f "${DB_PATH}-wal" ] && cp "${DB_PATH}-wal" "${BACKUP_FILE}-wal"

if [ $? -eq 0 ]; then
  SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 완료 (크기: ${SIZE})"
else
  echo "[ERROR] 백업 실패"
  exit 1
fi

# 오래된 백업 삭제 (KEEP_DAYS일 이상 된 파일)
if [ "${KEEP_DAYS}" -gt 0 ]; then
  DELETED=$(find "${BACKUP_DIR}" -name "cleaning-reservation-*.db" -mtime +"${KEEP_DAYS}" -print -delete | wc -l)
  if [ "${DELETED}" -gt 0 ]; then
    echo "  ${DELETED}개의 오래된 백업 파일 삭제됨 (${KEEP_DAYS}일 초과)"
  fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 완료"
