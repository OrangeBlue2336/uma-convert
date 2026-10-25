# AGENTS.md

이 문서는 이 저장소에서 작업하는 AI 에이전트(Claude, ChatGPT, Cursor, Copilot 등)를 위한 안내서입니다.
사람이 읽는 소개는 `Dev_README.md`를 먼저 보세요. 이 문서는 그보다 더 실무적인 규칙과, 코드를 왜 이렇게
짜 두었는지를 다룹니다.

## 이 프로젝트가 무엇인가

**UmaConvert**는 우마무스메 게임 폴더에서 꺼낸 파일을 브라우저 안에서 바로 변환하는 정적 웹사이트입니다.
GitHub Pages로 배포하며, 서버도 빌드 과정도 없습니다. 순수 HTML/CSS/JavaScript(ES 모듈)만 사용합니다.
개발자가 아닌 사람이 만들고 있으므로, 의존성을 늘리거나 빌드 도구(번들러, 트랜스파일러, 프레임워크)를
새로 들여오는 제안은 하지 마세요. 요청받지 않았다면 지금의 "파일 그대로 올리면 동작하는" 구조를 지키세요.

## 반드시 지킬 것

- **의존성 금지.** `npm install`이 필요한 것은 만들지 않습니다. `tests/*.mjs` 명령줄 도구도 Node.js
  내장 기능만 씁니다. master.mdb 탐색기가 `sql.js`(WASM) 대신 SQLite 읽기 코드를 직접 가진 것도 이 규칙
  때문입니다(아래 `core/sqlite.js` 항목).
- **`assets/js/core/`는 화면(DOM)을 몰라야 합니다.** 브라우저 전용 API(`document`, `window`, `canvas` 등)를
  이 폴더 안에 넣지 마세요. 그래야 `tests/convert-cli.mjs`처럼 Node.js에서도 그대로 돌릴 수 있고,
  화면 버그와 변환 버그를 구분해서 진단할 수 있습니다.
- **한국어 주석은 "왜"를 설명합니다.** 코드를 그대로 옮겨 적는 주석 대신, 왜 이렇게 짰는지(예: Unity가
  이미지를 아래쪽 줄부터 저장해서 뒤집는다, PNG를 canvas 대신 직접 만드는 이유 등)를 남기세요. 새 코드를
  추가할 때도 이 스타일을 따르세요.
- **핵심 로직을 건드리면 픽셀 단위로 재검증하세요.** 이 프로젝트는 "UABEA/UnityPy로 변환한 결과와 완전히
  같은 픽셀"이 핵심 가치입니다. `assets/js/core/decoders/`, `assets/js/core/texture.js`,
  `assets/js/core/sprites.js`, `assets/js/encode/png.js`를 고쳤다면, 최소한 다음을 확인하세요.
  1. `node tests/convert-cli.mjs <텍스처 파일> out`으로 오류 없이 끝까지 도는지
  2. 결과 PNG를 UABEA나 UnityPy(파이썬, `pip install UnityPy`) 같은 다른 도구의 결과와 픽셀 비교
     (파이썬 예시는 아래 "회귀 검증 방법" 참고)
  사용자가 테스트용 텍스처 파일 몇 개를 저장소 밖 어딘가에 가지고 있을 수 있으니, 없다면 요청하세요.
- **`core/usm.js`를 건드리면 청크 디먹싱과 복호화를 모두 재검증하세요.** `.usm` 청크를 그대로 이어
  붙인 결과가 CRID `@UTF` 표에 적힌 원본 filesize와 정확히 같아야 하고(`tests/usm-cli.mjs`로 확인),
  **이것만으로는 부족합니다** — XOR은 길이를 바꾸지 않으므로 filesize 일치는 청크 경계 파싱만
  검증할 뿐 복호화 내용까지 보장하지 않습니다. 영상은 파일 내부 이름에 `_no_encrypted` 표시가 있어도
  키 없이는 깨진다는 것이 실사용 테스트로 확인됐습니다. 그래서 지금은 파일 이름으로 자동판단하지 않고
  `convertUsm`이 기본으로 항상 키를 적용합니다. 오디오는 형식에 따라 정반대입니다 — HCA는 키를
  적용하면 무음이 되고, ADX는 반대로 키를 적용하지 않으면 디코더가 몇 프레임 만에 멈춥니다. 그래서
  오디오는 내용(헤더 시그니처)으로 형식을 먼저 판별하고(`detectAudioFormat`) ADX일 때만 키를
  적용합니다(`buildAudioTracks`). 오디오 형식을 나타내는 USM 내부 "audio_codec" 숫자 필드는
  게임/버전마다 뜻이 다른 것으로 보여 신뢰하지 않습니다. 복호화 결과를 눈으로 검증하려면
  `ffmpeg -i video.h264 -frames:v N -f null -` 로 디코드 오류(`Reference N >= 3` 등)가 없는지, ADX는
  `ffmpeg -i audio_N.adx x.wav && ffprobe -show_entries format=duration x.wav`로 길이가 원본과
  맞는지 확인하세요. 키 값(`DEFAULT_KEY_HI/LO`)과 상위/하위 32비트 순서는 사용자가 실사용 중인 값을
  그대로 넣어 둔 것입니다. 자세한 내용과 검증 이력은 파일 머리말 주석과 `plan.md`에 있습니다.
- **`wavFileName`(같은 파일)이 반환하는 이름에는 원본 오디오 확장자가 그대로 들어갑니다**
  (`audio_0.adx.wav`처럼, `audio_0.wav`가 아님). vgmstream-web 같은 브라우저 변환 사이트에
  `audio_0.adx`를 끌어다 놓으면 확장자를 지우지 않고 뒤에 `.wav`만 붙여서 내려주기 때문에, "다음 단계"
  카드가 안내하는 ffmpeg 합치기 명령도 이 이름과 맞아야 실제로 동작합니다. 이 함수를 고칠 일이 있으면
  이 동작(원본 확장자 유지)을 깨지 마세요.
- **파비콘·폰트·base.css 링크는 손으로 맞추지 말고 반드시 빌드로 반영하세요.** 이 세 가지는
  `_partials/head-common.html` 한 곳에서 관리되고, 각 페이지의 `<!-- BUILD:START head-common.html -->`
  ~ `<!-- BUILD:END -->` 사이에 `node build.mjs`가 채워 넣습니다. 이 블록 안을 직접 고치면 다음 빌드 때
  덮어써 사라지므로, 고칠 내용이 있으면 반드시 `_partials/head-common.html`을 고친 뒤 빌드를 실행하세요.
  새 변환기 페이지를 만들 때도 이 블록을 그대로 복사해 두면(내용은 비워둬도 됨) 빌드가 채워줍니다.
  자세한 동작은 `build.mjs` 파일 맨 위 주석을 참고하세요.
- **제목, 설명, breadcrumb, 본문처럼 페이지마다 다른 내용은 지금처럼 각 파일에 직접 적습니다.**
  빌드 대상이 아닙니다. 새 변환기 페이지를 만들 때 `sprite/index.html`을 복사해 시작하되, 이 부분만
  새 내용으로 바꾸세요.
- **`core/sqlite.js`를 고치면 파이썬 `sqlite3`와 행 단위로 다시 대조하세요.** 이 파일은 master.mdb(일반 rowid
  테이블, UTF-8, WAL 아님)를 읽는 데 필요한 만큼만 SQLite 형식을 구현한 읽기 전용 해석기입니다. 못 하는 것:
  SQL 실행, 인덱스 이용, WITHOUT ROWID(안내 오류), UTF-16. SQL 콘솔은 사용자가 필요 없다고 해서 만들지
  않았으니 요청 없이 sql.js를 끌어오지 마세요. 값 하나만 틀려도 사용자는 "게임 데이터가 이렇다"고 믿게 되므로
  `tests/mdb-cli.mjs verify`의 출력이 아래 "회귀 검증 방법"의 파이썬 출력과 **한 줄도 다르지 않아야** 합니다.
  실제 master.mdb에는 오버플로 페이지를 쓰는 행이 한 줄도 없어서(최대 행이 4061바이트 한도 안), 그 경로와
  64비트 정수, BLOB, 부동소수, 복합키, `ALTER TABLE ADD COLUMN` 기본값은 합성 DB로만 검증됩니다. 이 부분을
  고쳤다면 합성 DB 검증도 다시 하세요(예시는 "회귀 검증 방법").
- **`assets/data/mdb-map.json`은 사람이 확인한 사실만 담습니다. 이름이 비슷하다고 추측해 추가하지 마세요.**
  master.mdb에는 외래키가 하나도 선언되어 있지 않아서 연결 정보가 전부 이 사전에서 나옵니다. 값이 우연히
  다른 테이블의 id에 많이 들어맞는 것은 증거가 못 됩니다(값 종류가 적은 컬럼은 아무 큰 테이블에나 맞습니다).
  새 항목은 반드시 (1) 사용처마다 id 적중률을 재고 (2) 안 맞는 테이블은 `except`로 빼거나 `only`로 한정하며
  (3) 샘플 텍스트를 눈으로 보고 역할 이름을 붙이세요. 특히 `item_id`는 `item_category`에 따라 가리키는 대상이
  달라서(다형 참조) `item_category` 컬럼이 있는 테이블은 전부 `except`입니다. 어느 카테고리가 어느 테이블인지
  확인되기 전에는 링크를 만들지 마세요(틀린 링크가 링크 없음보다 해롭습니다). 숫자 코드의 뜻(값 라벨)도 같은
  이유로 기본값을 비워 두고, 사용자가 직접 적은 것만 브라우저에 저장합니다.
- **스킬이 어느 카드에 연결되는지는 경로가 여러 개이고, 한 경로만 따라가면 조용히 누락됩니다.** 확인된 경로:
  육성 우마무스메(승부복) = `available_skill_set`(`card_data.available_skill_set_id`), 서포트 카드 힌트 =
  `single_mode_hint_gain`(`hint_gain_type=0`일 때 `hint_value_1`이 스킬 id, `support_card_id`가 카드;
  `support_card_data.skill_set_id`는 `skill_set`이 아니라 이 테이블의 `hint_id`와 이어짐). 같은 스킬 그룹
  (`skill_data.group_id`)에는 등급이 다른 스킬(예: 202711 rarity 2, 202712 rarity 1)이 묶여 있고 서포트 카드는 한쪽만
  힌트로 주는 경우가 있어서, "정확히 이 스킬"과 "같은 그룹의 다른 스킬"을 **구분해 따로** 보여 줍니다
  (`holders`/`holdersGroup`/`hints`/`hintsGroup`). 아직 연결하지 않은 경로: `succession_factor_effect`(계승 인자),
  `skill_set`(시나리오/레이스 세트), `skill_upgrade_speciality`(시나리오별 강화). 스킬 id가 값으로 쓰이는 곳은
  `value` 전수 검색으로 찾으세요(컬럼 이름에 skill이 없는 곳이 있습니다).
- **master.mdb의 "추정"과 "확정"을 화면에서 섞지 마세요.** 사전에 있는 것은 확정, 번호 집합이 겹쳐서 짐작한
  것은 반드시 "추정"으로 따로 표시합니다. 추정은 세 단계입니다: `auto`(카테고리 번호가 모두 테이블 id에 있고
  테이블 행의 절반 이상이 텍스트를 가짐), `weak`(번호는 모두 있지만 일부 행만 가짐 — 새 캐릭터에만 있는 프로필 항목
  같은 경우, 접어서 비율과 함께 표시), `other`(번호만 우연히 같음). **추정 기준을 전체적으로 낮추지 마세요.**
  측정해 보니 기준을 낮추면 맞는 것과 틀린 것이 섞입니다(예: 캐릭터 텍스트로 보이는 159~161, 189가 걸리는 동시에
  챔피언스/배너 테이블에도 엉뚱하게 걸림). 확정하려면 샘플 텍스트를 확인하고 `mdb-map.json`에 등록하세요.
- **게임 텍스트의 줄바꿈 표기는 "화면 표시"에서만 실제 줄바꿈으로 바꿉니다.** master.mdb의 글자에는 진짜 줄바꿈이
  하나도 없고 백슬래시+n 두 글자가 줄바꿈 자리에 들어 있습니다(text_data 21,233행, race_jikkyo 메시지 2,865행).
  변환은 `core/mdbMeaning.js`의 `gameText()` 한 곳에서 하며, `MdbCatalog.load()`(이름/설명/검색)와 `valueInfo()`(표 셀,
  "풀이해서 저장")에만 적용됩니다. **DB에서 읽은 원본 값, 기본 CSV/JSON 저장, 버전 비교는 변환하지 않습니다**(원본
  그대로 비교/저장해야 하므로). `<color=...>` 같은 서식 표기는 건드리지 않습니다.
- **게임 데이터 안의 글자는 항상 `textContent`로만 화면에 넣으세요.** `innerHTML`로 이어 붙이지 않습니다
  (`ui/dom.js`의 `el`이 이를 지킵니다). 업로드된 파일 내용이 화면 구조를 깨거나 스크립트로 해석될 여지를 없애기
  위해서입니다.
- **텍스트를 바꿀 때 화면 3곳을 함께 확인하세요.** 같은 문구가 `index.html`/`sprite/index.html`(정적 텍스트),
  `assets/js/tools.js`(메인 타일 문구), `assets/js/sprite/main.js`나 `list.js`(동적으로 만드는 문구) 중
  여러 곳에 나뉘어 있을 수 있습니다.

## 디렉터리 구조와 각 폴더의 책임

```
index.html                 메인 페이지
sprite/index.html          스프라이트 변환기 페이지
lyrics/index.html          라이브 가사 변환기 페이지
usm/index.html              .usm 영상 데이터 변환기 페이지
mdb/index.html              master.mdb 탐색기 페이지
favicon/                   파비콘 파일 일체 (realfavicongenerator.net 산출물이 들어갈 자리)
assets/
  css/
    base.css                 모든 페이지가 함께 쓰는 색·글꼴·버튼·머리말/꼬리말
    home.css                 메인 페이지 타일 전용
    converter.css            변환기 페이지 공통(탭, 드롭존, 결과 화면, 뷰어, 목록) — 새 변환기도 이걸 재사용
  data/
    mdb-map.json             master.mdb 탐색기가 읽는, 사람이 확인한 사전(text_data 카테고리, 참조 컬럼, 도메인 보기 설정)
  img/                      파비콘이 아닌 그림 (타일 SVG/PNG 등)
  js/
    tools.js                 메인 페이지 타일 목록의 데이터. 새 변환기는 여기 한 항목만 추가하면 노출됨
    home.js                  tools.js를 읽어 타일 DOM을 그림
    core/                    파일 해석 + 복원. DOM 의존 금지 (위 규칙 참고)
      reader.js                바이트 읽기 도우미
      lz4.js                   LZ4 블록 압축 해제
      unityfs.js               UnityFS 번들 머리글 파싱, 내부 파일 추출
      serialized.js            SerializedFile(CAB-... 파일) 파싱, 오브젝트 목록
      typetree.js              타입트리 기반 필드 읽기 (Unity 버전이 달라도 동작하는 핵심)
      commonStrings.js         타입트리가 참조하는 공용 문자열 표 (생성 방법은 아래 참고)
      texture.js               Texture2D 오브젝트 -> RGBA 픽셀
      sprites.js               Sprite 오브젝트 -> 잘라낼 영역 목록, 실제 자르기
      convert.js               위 전부를 묶는 진입점 (convertBundle)
      decoders/                텍스처 형식별 디코더. 새 형식 추가는 여기 + index.js 한 줄
      lyrics.js                라이브 가사 에셋 파싱 -> 자막 형식 변환
      usm.js                   CRI USM 컨테이너 파싱 + 청크 복호화 + h264/hca 분리 (자세한 설계는 파일
                                머리말 주석과 저장소 최상위 `plan.md` 참고)
      sqlite.js                SQLite 읽기 전용 해석기(테이블 목록/스키마, 행 읽기, rowid 조회). master.mdb용
      mdbMeaning.js            숫자 코드를 이름/링크로 푸는 계층(MdbCatalog): 이름, 참조, 역참조, 텍스트 검색, 시간/라벨, 줄바꿈 변환(gameText)
      mdbDomains.js            "도메인 보기"(캐릭터, 육성 우마무스메(승부복), 서포트 카드, 스킬 등)를 mdb-map.json 설정대로 조립.
                               단계 옵션 where/excludeRoot, 구역 옵션 minus/hideEmpty 지원
      mdbDiff.js               두 master.mdb 버전 비교(추가/삭제/변경, 스키마 변경)
      errors.js                ConvertError: 사용자에게 그대로 보여줘도 되는 오류
    encode/
      png.js                   RGBA -> PNG. canvas를 쓰지 않는 이유는 파일 안 주석 참고
      zip.js                   여러 파일을 압축 없이 ZIP으로 묶기 (스프라이트 PNG, usm의 h264/hca 등 공용)
      crc32.js                 PNG/ZIP 공용
      csv.js                   표 -> CSV 글자(엑셀용 BOM 포함). master.mdb 탐색기의 내보내기
    sprite/                   스프라이트 페이지 전용 화면 코드 (다른 변환기는 건드리지 않음)
      main.js                   파일 열기~저장까지 전체 배선
      viewer.js                 이미지 위에 조각 영역을 겹쳐 그리는 뷰어
      list.js                   오른쪽 조각 목록 패널
      correction.js             "크기 보정" 기능. RGBA를 정해진 크기로 강제 리사이즈 (아래 별도 절 참고)
    lyrics/main.js            라이브 가사 페이지 전용 화면 코드
    usm/main.js               .usm 페이지 전용 화면 코드 (파일 열기, 키 적용 토글, ZIP 저장,
                              결과에 맞춘 "다음 단계" 명령 렌더링)
    mdb/                      master.mdb 탐색기 전용 화면 코드. 해석은 core/에 있고 여기는 그리기만 함
      main.js                   파일 열기, 탭, 각 화면 연결. 모든 링크가 쓰는 openId/openTable/openDomain
      tableView.js              테이블 목록 + 표(열 필터, 정렬, 페이지, 열 숨기기, CSV/JSON 저장)
      drawer.js                 행 상세 서랍(값, 연결 텍스트, "이 항목을 가리키는 곳", 뒤로 가기)
      searchView.js             text_data 검색 -> 주인 행으로 이동
      domainView.js             도메인 보기(목록 + 구역별 상세)
      diffView.js               버전 비교(주요 항목 요약, 테이블별 추가/삭제/변경)
      cell.js                   셀 한 개를 풀어 그리는 공용 규칙(링크, 날짜, 라벨)
      labels.js                 사용자가 붙이는 값 라벨(localStorage) + 편집 창
    ui/                       여러 변환기 페이지가 함께 쓰는 화면 도우미
      tabs.js                   탭 전환
      dom.js                    el/button: 글자를 항상 textContent로 넣는 요소 만들기
      download.js               파일 저장, 이름 정리
      clipboard.js              명령줄 복사 버튼 (usm의 "다음 단계" 카드가 씀)
tests/convert-cli.mjs      화면 없이 core+encode만 실행하는 명령줄 도구 (스프라이트, 회귀 확인용)
tests/usm-cli.mjs          화면 없이 core/usm.js만 실행하는 명령줄 도구
tests/mdb-cli.mjs          화면 없이 master.mdb 코어를 실행(info/dump/verify/search/domain/diff)하는 명령줄 도구
plan.md                    .usm 변환기 설계 조사 기록. 의존성 도입 여부(A/B/C안) 판단과 다음 단계(알파
                            합성 등)를 다룰 때 먼저 읽으세요.
```

## 새 변환기를 추가하는 절차

1. `assets/js/tools.js`의 배열에 항목을 추가합니다. 아직 안 만들었다면 `status: "soon"`.
2. `sprite/index.html`을 복사해 새 폴더(`lyrics/index.html` 등)를 만듭니다. 머리말(breadcrumb), 탭 구조,
   스타일시트 링크를 그대로 가져오고 상대 경로(`../`)만 확인하세요. `<!-- BUILD:START head-common.html -->`
   ~ `<!-- BUILD:END -->` 블록도 그대로 복사해 두면 됩니다(내용이 조금 안 맞아도 다음 빌드에서 고쳐집니다).
   폴더가 두 단계 이상 깊어지면(`assets/js/tools.js`와 무관하게 폴더만 깊어지는 경우) `build.mjs`가
   깊이를 자동으로 계산하므로 `{{ROOT}}` 관련 수정은 필요 없습니다.
3. 페이지 전용 화면 코드는 `assets/js/<변환기이름>/`에 새로 만듭니다. `sprite/main.js`가 좋은 본보기입니다.
   파일 파싱이 필요하면 `core/`를 재사용하고, 화면 전용 로직만 새로 짜세요.
4. 결과를 저장하는 기능이 필요하면 `assets/js/encode/`, `assets/js/ui/download.js`를 재사용하세요.
5. 변환기 페이지 전용 스타일이 많이 필요하면 `converter.css`에 추가하되, 다른 변환기도 쓰는 클래스
   이름(`.dropzone`, `.tab` 등)은 그대로 두고 새 클래스만 보태세요.
6. 커밋하기 전에 `node build.mjs`를 실행하세요. 새로 만든 페이지의 파비콘/폰트 블록을 채워주고,
   빠뜨린 페이지가 있으면 뭘 건드렸는지 알려줍니다.

## 새 텍스처 형식(디코더)을 추가하는 절차

1. `assets/js/core/decoders/`에 `(bytes, width, height) => RGBA Uint8Array`를 반환하는 함수를 만듭니다.
   `dxt.js`나 `raw.js`를 본보기로 삼으세요. 상하 반전은 `texture.js`의 `flipVertical`이 공통으로
   처리하므로 디코더는 Unity가 저장한 순서(아래쪽 줄부터) 그대로 돌려주면 됩니다.
2. `decoders/index.js`의 `FORMATS` 배열에 `{ id, name, decode, size }` 한 줄을 추가합니다. `id`는 Unity의
   `m_TextureFormat` 번호이고, `KNOWN_UNSUPPORTED`에 있었다면 그 줄을 지우세요.
3. 임의 바이트로 만든 테스트 벡터를 UnityPy(`from UnityPy.export.Texture2DConverter import parse_image_data`)
   같은 기존 도구로 돌려 기대값을 만들고, 새 디코더 결과와 바이트 단위로 비교하세요. 이 저장소를 만들 때도
   이 방식으로 11개 형식을 전부 검증했습니다.

## 스프라이트 "크기 보정" 기능(`assets/js/sprite/correction.js`)이 canvas를 쓰는 이유

서포트 카드, 칭호처럼 일부 조각은 게임 데이터 안에서부터 이미 비율이 눌린 채(가로나 세로가 늘어난
채)로 저장되어 있습니다. 실제 게임도 이 조각을 쓸 때 항상 같은 고정 크기로 늘려서 쓰므로, 이 기능은
지금 고른 조각(또는 조각 정보가 없는 텍스처는 전체 이미지)을 그 고정 크기로 강제로 리샘플링해
원래 비율로 되돌립니다. 서포트 카드는 1536×2048, 칭호는 512×105로 하드코딩되어 있습니다
(`CORRECTION_PRESETS`).

**이 파일만 예외적으로 canvas의 `drawImage` 확대/축소를 씁니다.** `encode/png.js`가 `canvas.toBlob()`을
피하는 이유(반투명 픽셀의 색이 미세하게 바뀜, 파일 머리말 주석 참고)와 이 기능은 목적이 다릅니다 —
여기서는 "크기 자체를 바꾸는" 것이 목적이라 애초에 원본 픽셀을 그대로 보존할 수 없고, 대신 확대/축소
시 매끄러운 보간이 필요합니다. 그래서 `resizeRGBA`는 `putImageData`로 원본을 넣은 뒤 `drawImage`로
크기를 바꾸고 `getImageData`로 다시 꺼냅니다. 이 예외를 다른 저장 경로(PNG 저장, ZIP 저장 등)로
번지게 하지 마세요 — 그쪽은 지금처럼 `encode/png.js`를 그대로 씁니다.

새 조각 종류에서 같은 문제(비율이 눌려 나옴)를 발견하면 `CORRECTION_PRESETS`에 `{ label, width,
height }`를 하나 추가하고, `sprite/index.html`에 버튼을 하나 더 만든 뒤 `assets/js/sprite/main.js`의
`fixSupportButton`/`fixHonorButton` 배선을 본떠 연결하면 됩니다. 대상 선택 순서(클릭한 조각 ->
조각이 하나뿐인 텍스처 -> 조각 정보가 아예 없는 텍스처는 전체 이미지 -> 그 외엔 안내 문구)는
`pickCorrectionSource`(`main.js`)에 있습니다.

## 타입트리 공용 문자열 표(`commonStrings.js`)가 뭔가요

Unity 타입트리는 `AABB`, `float`, `string` 같은 흔한 이름을 반복해서 저장하지 않고, 미리 정해진 표의
번호로 대신 가리킵니다. `commonStrings.js`는 그 표를 그대로 옮긴 것입니다. UnityPy 라이브러리 안의
`UnityPy.helpers.Tpk.get_common_strings()` 결과를 순서 그대로 문자열로 이어 붙여 만들었습니다. 이 표는
Unity 버전이 달라져도 앞부분은 바뀌지 않고 뒤에 추가만 되는 값이라, 당장은 다시 만들 필요가 거의 없습니다.
정말 새로 만들어야 한다면 위 함수 결과를 오프셋 순서대로 이어 붙이면 됩니다.

## 회귀 검증 방법 (핵심 로직을 고쳤을 때)

파이썬이 있는 환경이라면 아래로 기준값을 만들어 비교할 수 있습니다.

```python
import UnityPy
env = UnityPy.load("텍스처파일")
for o in env.objects:
    if o.type.name == "Texture2D":
        o.read().image.save("reference.png")
```

이렇게 만든 `reference.png`와 이 프로젝트로 만든 결과 PNG를 `numpy`로 픽셀 단위 비교(`(a != b).sum()`이
0인지)하면 됩니다. UABEA로 변환한 결과와 비교해도 됩니다. 둘 다 참고 도구일 뿐 정답은 아니지만, 이 값에서
벗어나면 대개는 이쪽 버그입니다.

## master.mdb 탐색기 회귀 검증 (`core/sqlite.js`, `core/mdb*.js`를 고쳤을 때)

1. **전 테이블 내용 대조.** `node tests/mdb-cli.mjs verify master.mdb > node.txt`와 아래 파이썬 출력이
   `diff`로 완전히 같아야 합니다(597개 테이블, 약 2초).

```python
import sqlite3, hashlib
c = sqlite3.connect("file:master.mdb?mode=ro", uri=True)
names = sorted(r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"))
def canon(v):  # tests/mdb-cli.mjs 의 canonical()과 같은 규칙
    if v is None: return "N"
    if isinstance(v, bytes): return "b" + v.hex()
    if isinstance(v, int): return "i" + str(v)
    if isinstance(v, float): return ("i" + str(int(v))) if v == int(v) else "f" + repr(v)
    return "t" + v
for n in names:
    h = hashlib.sha256(); k = 0
    for row in c.execute(f'select * from "{n}" order by rowid'):   # order by rowid 필수(커버링 인덱스 순서로 나올 수 있음)
        h.update(("\x1f".join(canon(v) for v in row) + "\n").encode()); k += 1
    print(f"{n}\t{k}\t{h.hexdigest()}")
```

2. **스키마/행 조회.** 테이블마다 `pragma table_info`의 컬럼 이름/타입/PK와 `parseCreateTable` 결과가 같은지,
   `countRows`/`rowids`/`getRow`가 파이썬과 같은지(없는 rowid는 `null`).
3. **합성 DB로 실제 파일에 없는 경로 검증.** 오버플로 페이지를 쓰는 큰 TEXT/BLOB(수 KB~40KB), `integer primary key`
   테이블 3,000행(B-tree 여러 층), 64비트 경계 정수, REAL, 복합키, `ALTER TABLE ... ADD COLUMN ... DEFAULT`,
   따옴표/공백이 든 컬럼 이름, WITHOUT ROWID(안내 오류가 나와야 함)를 넣은 임시 DB를 만들어 같은 방식으로 대조합니다.
4. **버전 비교.** 실제 파일을 복사해 일부 행 수정/삭제/추가, `text_data`(복합키) 변경, PK 없는 테이블 변경,
   `ALTER TABLE ADD COLUMN`, 테이블 추가/삭제, `VACUUM`(rowid가 바뀌는 것까지)을 가한 뒤, 파이썬이 공통 컬럼과
   PK로 직접 센 추가/삭제/변경 수와 `tests/mdb-cli.mjs diff` 결과가 같은지 확인합니다. 같은 파일끼리 비교하면
   바뀐 테이블이 0개여야 합니다.
5. **스킬 연결 구역 대조.** 모든 스킬(1,997개)에 대해 `holders`/`holdersGroup`/`hints`/`hintsGroup` 결과가, 파이썬으로
   `available_skill_set`, `single_mode_hint_gain`(hint_gain_type=0), `group_id`를 직접 조인한 집합과 같은지 확인합니다.
   빠른 확인은 `node tests/mdb-cli.mjs domain master.mdb skill 202711`(서포트 카드 5장이 `hintsGroup`에 나와야 함).
6. **사전(`mdb-map.json`) 검증.** 사전에 적은 테이블/컬럼 이름이 실제 DB에 모두 있는지, `texts`의 카테고리가
   테이블 id에 95% 이상 맞물리는지, `refs`의 `except` 밖 사용처가 98% 이상 맞는지 다시 계산하세요.
   `findReferences`의 결과는 파이썬으로 같은 조건의 `count(*)`를 세어 대조하면 됩니다.
7. **화면.** 브라우저에서 파일을 직접 열어 보세요. 이 저장소의 자동 점검은 jsdom(저장소에 넣지 않는 임시 도구)으로
   흐름(열기, 필터, 정렬, 링크, 검색, 도메인, 비교)만 확인했고 CSS 배치, 끌어놓기, `<dialog>` 같은 실제 브라우저
   동작은 확인하지 못했습니다.

## 자동 배포 (`.github/workflows/pages.yml`)

`main`에 푸시하면 GitHub Actions가 `node build.mjs`를 실행한 뒤 그 결과를 GitHub Pages로 바로
배포합니다. `GITHUB_TOKEN`으로 저장소에 다시 커밋하는 방식(흔히 보는 "빌드 결과를 gh-pages 브랜치에
커밋" 패턴)은 **일부러 쓰지 않았습니다** — GitHub 공식 문서에 따르면 그 토큰으로 푸시된 커밋은 Pages
재빌드를 트리거하지 않아서, 배포가 조용히 안 되는 함정이 있습니다. 대신 같은 실행 안에서 빌드와 배포를
모두 끝내는 `actions/upload-pages-artifact` + `actions/deploy-pages` 조합을 씁니다(둘 다 GitHub 공식
액션이며, 저장소 설정에서 Pages Source를 "GitHub Actions"로 지정해야 동작합니다). 이 워크플로 파일을
고칠 때는 이 배경을 참고해서, 별도 브랜치에 커밋하는 방식으로 되돌리지 마세요.

## 파비콘 (`favicon/` 폴더)

`favicon/`에는 realfavicongenerator.net에서 만든 파일들이 들어갑니다. 지금 들어 있는 파일은 임시로
`assets/img`에 있던 기존 SVG를 여러 크기로 늘려 만든 자리채움입니다. 이 폴더의 파일 이름
(`favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png`, `site.webmanifest`,
`web-app-manifest-192x192.png`, `web-app-manifest-512x512.png`)과 각 HTML의 `<head>` 5줄은
realfavicongenerator.net이 주는 표준 형식과 맞춰 두었습니다. 사용자가 그 사이트에서 새로 받은 파일로
이 폴더를 통째로 바꾸는 것을 전제로 하므로, 에이전트가 이 폴더의 내용을 생성 로직으로 다루지 마세요(즉
SVG에서 자동 생성하는 스크립트 같은 것을 파이프라인에 넣지 마세요). 사람이 직접 관리하는 자산입니다.

## 다국어(한국어/영어) 지원

이미 구현되어 있습니다(`assets/js/i18n/`, 방식은 `Dev_README.md`의 "다국어 지원" 절). 새 화면 문구는 HTML에
`data-i18n` 키, JS에는 `t("키")`로 쓰고 `ko`/`en` 사전 두 곳에 모두 추가하세요. 둘 중 하나만 채우면 한쪽 언어에서
키 이름이 그대로 보입니다. `mdb` 페이지는 코드가 쓰는 키와 사전 키를 스크립트로 대조해 누락이 없음을 확인했습니다.
`ConvertError`의 키(`error.sqlite.*` 등)도 같은 사전에서 찾으므로 새 오류를 만들면 두 언어 사전에 함께 적으세요.

## 저작권/콘텐츠 관련 규칙

- 이 저장소에는 게임에서 추출한 원본 에셋 파일(텍스처, 사운드 등)과 `master.mdb` 자체를 절대 커밋하지 마세요.
  `assets/data/mdb-map.json`에는 테이블/컬럼 이름과 카테고리 번호, 역할 이름만 있고 게임 텍스트는 넣지 않습니다. 테스트용
  파일은 저장소 밖(`/tmp`, 업로드 폴더 등)에 두고, `.gitignore`로 막혀 있는지 확인하세요.
- 메인 페이지 꼬리말의 "팬이 만든 비공식 도구" 문구와 원작 도구(UABEA, UmamusumeExplorer 등) 크레딧
  링크는 유지하세요.
