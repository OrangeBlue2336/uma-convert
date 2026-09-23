# UmaConvert

게임 폴더에서 꺼낸 파일을 브라우저에서 바로 변환하는 도구 모음입니다.
모든 처리는 사용자 컴퓨터 안(브라우저)에서 이루어지며, 파일은 어디로도 전송되지 않습니다.

다른 AI 도구로 이어서 작업하신다면 `AGENTS.md`를 먼저 읽어 주세요. 이 파일보다 더 실무적인 규칙이
정리되어 있습니다.

| 주소 | 내용 | 상태 |
|---|---|---|
| `/` | 변환기 목록 | 사용 가능 |
| `/sprite/` | 텍스처 파일 -> PNG, 조각별 PNG(ZIP) | 사용 가능 |
| `/lyrics/` | 라이브 가사 변환 | 준비 중 |

## 커밋하기 전에: `node build.mjs`

파비콘·폰트·base.css 링크처럼 모든 페이지에 똑같이 들어가야 하는 부분은 `_partials/head-common.html`
한 곳에서만 관리합니다. 이 파일이나 페이지 파일(`index.html` 등)을 고쳤다면, 커밋하기 전에 저장소
최상위에서 아래 명령을 한 번 실행하세요. (Node.js 18 이상이면 됩니다. 이미 `tests/convert-cli.mjs` 때문에
설치되어 있을 가능성이 높습니다.)

```
node build.mjs
```

실행하면 어떤 파일이 바뀌었는지 화면에 보여줍니다. 아무것도 안 바뀌었다면 "갱신된 파일 0개"라고
나오는데, 정상입니다. **이 명령을 실행하지 않고 커밋해도 사이트가 깨지지는 않습니다.** 다만 파비콘 같은
공용 부분을 고쳤다면 이 명령을 돌려야 그 결과가 모든 페이지에 반영됩니다. (아래 "배포하기"의 방법 B로
자동 배포를 설정했다면, 이 단계를 깜빡해도 배포될 때 자동으로 실행되니 크게 걱정하지 않아도 됩니다.
다만 로컬에서 결과를 미리 보려면 그래도 한 번 실행해야 합니다.) 자세한 동작 원리는
`build.mjs` 파일 맨 위 주석과 `AGENTS.md`에 있습니다.

## 배포하기 (GitHub Pages)

두 가지 방법이 있습니다. **방법 B(자동 배포)를 추천합니다.** `node build.mjs` 실행을 깜빡해도 배포 시점에
GitHub이 알아서 채워주기 때문에 실수할 일이 적습니다.

### 방법 A. 손으로 빌드해서 커밋 (지금까지의 방식)

1. 저장소를 만듭니다. (예: `uma-convert`. 이름은 자유이며, 이 프로젝트의 모든 경로는 상대 경로라 저장소
   이름과 무관하게 동작합니다.)
2. 이 폴더의 내용물을 저장소 최상위에 올립니다. (`index.html`이 최상위에 있어야 합니다.) 이때
   `node build.mjs`를 이미 실행해서 나온 결과 그대로 올리면 됩니다.
3. 저장소의 Settings -> Pages -> Build and deployment 에서
   Source를 "Deploy from a branch", Branch를 `main`, 폴더를 `/ (root)`로 지정합니다.
4. 잠시 뒤 `https://(아이디).github.io/(저장소 이름)/` 로 접속됩니다.

### 방법 B. 커밋할 때마다 자동으로 빌드 + 배포 (`.github/workflows/pages.yml`)

`main`에 푸시할 때마다 GitHub이 `node build.mjs`를 대신 실행하고, 그 결과를 바로 배포합니다.
`node build.mjs`를 로컬에서 실행하는 걸 깜빡해도 배포되는 사이트는 항상 최신 상태입니다.

1. 위 방법 A의 1~2번과 똑같이 저장소를 만들고 올립니다. (`node build.mjs`를 미리 실행해 두지
   않아도 되지만, 로컬에서 어떻게 보이는지 확인하고 싶다면 해도 됩니다.)
2. 저장소의 Settings -> Pages -> Build and deployment 에서 Source를 **"GitHub Actions"**로
   지정합니다. (방법 A의 "Deploy from a branch"가 아닙니다.)
3. Settings -> Actions -> General -> Workflow permissions 에서 "Read and write permissions"가
   선택되어 있는지 확인합니다. (대부분 기본값으로 이미 선택되어 있습니다.)
4. `main`에 아무 커밋이나 푸시하면 저장소의 Actions 탭에 "빌드 후 GitHub Pages에 배포" 실행이 뜨고,
   1분 정도 뒤 `https://(아이디).github.io/(저장소 이름)/`에 반영됩니다. Actions 탭에서 진행 상황과
   혹시 실패했을 때의 오류 메시지를 볼 수 있습니다.

두 방법을 섞어 써도 문제없습니다. 나중에 방법 A로 되돌리고 싶으면 Settings -> Pages에서 Source를
"Deploy from a branch"로 다시 바꾸면 됩니다(워크플로 파일을 지울 필요는 없고, 안 쓰이게 될 뿐입니다).

## 내 컴퓨터에서 확인하기

`index.html`을 더블클릭하면 브라우저가 모듈 로딩을 막아 동작하지 않습니다.
저장소 최상위 폴더에서 아래 두 줄을 실행한 뒤 `http://localhost:8000` 으로 접속하세요.

```
node build.mjs
python -m http.server 8000
```

`node build.mjs`는 파일을 하나 고칠 때마다 매번 실행할 필요는 없고, `_partials/`나 페이지 파일을 고친
뒤 결과를 확인하고 싶을 때만 실행하면 됩니다. (`assets/js`, `assets/css`처럼 이 블록과 무관한 파일을
고쳤을 때는 그냥 새로고침만 하면 됩니다.)

## 폴더 구조

```
index.html                메인 페이지
sprite/index.html         스프라이트 변환기 페이지
favicon/                  파비콘 (아래 "파비콘 바꾸기" 참고)
_partials/head-common.html  모든 페이지가 함께 쓰는 <head> 조각 (파비콘·폰트·base.css)
.github/workflows/pages.yml  커밋할 때마다 자동으로 빌드+배포 (설정 방법은 위 "배포하기" 방법 B 참고)
build.mjs                 위 조각을 각 페이지에 채워 넣는 도구. 실행법은 위 "커밋하기 전에" 참고
assets/
  css/                    base(공통) / home(메인) / converter(변환기 페이지)
  img/                    타일 그림 등
  js/
    tools.js              메인 페이지 변환기 목록  <- 새 변환기는 여기에 추가
    home.js                tools.js를 읽어 타일을 그림
    core/                  번들 해석과 이미지 복원 (화면과 무관)
    encode/                PNG, ZIP 생성
    sprite/                스프라이트 페이지 전용 화면 코드
    ui/                    여러 페이지가 함께 쓰는 탭, 저장 도우미
tests/convert-cli.mjs     웹 없이 변환만 실행해 보는 도구
```

## 변환기 추가하기

1. `assets/js/tools.js` 배열에 항목을 하나 추가합니다. (`status: "soon"`이면 준비 중 표시)
2. 폴더를 만들고 `index.html`을 넣습니다. 예: `lyrics/index.html`
   (`sprite/index.html`을 복사해 시작하면 머리말, 탭, 스타일, 파비콘 블록이 그대로 따라옵니다.)
   다 만든 뒤 `node build.mjs`를 한 번 실행하세요.
3. 페이지 전용 코드는 `assets/js/lyrics/` 처럼 같은 이름의 폴더에 둡니다.
4. 타일 그림은 `assets/img/`에 넣고 `tools.js`의 `image`에 적습니다. (SVG, PNG 모두 가능. 아래
   "타일 그림 바꾸기" 참고)

## 스프라이트 변환기가 지원하는 것

- 파일: Unity 에셋번들(UnityFS), LZ4 계열 압축, Unity 2017 이상
- 텍스처 형식: DXT1, DXT5, RGBA32, ARGB32, BGRA32, RGB24, RGB565, RGBA4444, ARGB4444, Alpha8, R8
- 미지원: BC7, ETC/ETC2, ASTC, PVRTC, Crunch 압축, LZMA 압축 번들, 암호화된 파일
  (만나면 형식 이름과 함께 안내 문구가 표시됩니다.)

새 텍스처 형식은 `assets/js/core/decoders/`에 디코더를 만들고
`decoders/index.js`의 `FORMATS`에 한 줄 추가하면 됩니다.

## 명령줄로 변환해 보기 (Node.js 18 이상)

```
node tests/convert-cli.mjs 파일이름 결과폴더
```

웹에서 결과가 이상할 때 같은 코어를 직접 실행해 원인이 화면인지 변환인지 구분할 수 있습니다.

## 파비콘 바꾸기

지금 `favicon/` 폴더에는 자리채움 파비콘이 들어 있습니다. 직접 만들고 싶다면:

1. https://realfavicongenerator.net 에서 그림을 올려 파비콘을 만듭니다.
2. 사이트 설정 중 "Path"(또는 "Favicon files location") 항목에 이 프로젝트에서 파비콘을 두는 위치를
   그대로 입력합니다. 메인 페이지 기준으로는 `favicon/`, `favicon/`으로 시작하는 값이면 됩니다.
3. 내려받은 압축 파일의 내용물로 이 프로젝트의 `favicon/` 폴더를 통째로 덮어씁니다. 파일 이름이
   `favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png`, `site.webmanifest`,
   `web-app-manifest-192x192.png`, `web-app-manifest-512x512.png`로 지금과 같다면 그대로 덮어써도 됩니다.
4. 사이트가 realfavicongenerator.net에서 준 HTML 코드를 `_partials/head-common.html`에 붙여넣습니다.
   **페이지 파일은 건드리지 않아도 됩니다.** 다만 그 사이트가 주는 코드는 경로가 `favicon/...`처럼
   되어 있을 텐데, 이 프로젝트에서는 페이지 깊이에 따라 경로가 달라져야 하므로 `favicon/` 부분을
   `{{ROOT}}favicon/`으로 바꿔 주세요. (예: `href="favicon/favicon.svg"` → `href="{{ROOT}}favicon/favicon.svg"`)
5. `node build.mjs`를 실행하면 모든 페이지에 반영됩니다.
6. `site.webmanifest` 안의 `name`, `theme_color`, `background_color`를 원하는 값으로 바꿔도 됩니다.

## 타일 그림 바꾸기 (SVG -> PNG로 직접 교체하기)

`tools.js`의 `image` 값은 `<img src>`로 그대로 쓰이므로 SVG든 PNG든 상관없이 동작합니다. 코드를 바꿀
필요 없이 그림 파일만 바꾸고 `tools.js`의 경로만 맞추면 됩니다.

- **비율**: 타일 그림 영역은 가로세로 16:7 비율입니다. 이 비율이 아니면 그림이 위아래로 여백이 생기거나
  잘릴 수 있습니다. (표시 방식은 `object-fit: contain`이라 잘리지는 않고, 여백이 생기는 정도입니다.)
- **권장 크기**: 화면에는 타일이 최대 약 500×220px 정도로 보입니다. 고해상도 화면에서도 선명하도록
  그 2배인 **1000×440px**(또는 같은 비율의 다른 크기) 정도를 권장합니다. 너무 크면 페이지 로딩이 느려질
  수 있으니 2000×880px을 넘길 필요는 없습니다.
- **배경**: 배경이 투명한 PNG(PNG-24, 알파 채널 포함)를 쓰면 지금의 SVG 타일과 똑같이 체크무늬 배경
  위에 자연스럽게 올라갑니다. 배경을 흰색으로 채운 PNG도 동작은 하지만, 흰 사각형처럼 보일 수 있습니다.
- **용량**: 웹에 올라가는 그림이니 200KB 이하를 권장합니다. 사진을 그대로 쓰기보다, 필요하면 압축
  도구(예: squoosh.app)로 한 번 줄이는 것을 추천합니다.
- **적용 방법**: 그림 파일을 `assets/img/tile-스프라이트.png`처럼 저장한 뒤, `tools.js`에서 해당 항목의
  `image: "assets/img/tile-sprite.svg"` 줄을 `image: "assets/img/tile-sprite.png"`로 바꾸면 끝입니다.

## 다국어(한국어/영어) 지원 — 설계만 해둔 상태

아직 구현되어 있지 않지만, 지금 구조를 크게 바꾸지 않고 넣을 수 있는 방식을 정리해 둡니다. 나중에
"다국어 넣어줘"라고 요청하면 이 방식을 기본으로 진행하면 됩니다.

**방식: 실행 시점에 문구를 사전(JSON)으로 바꿔치기.** 지금처럼 정적 HTML 파일을 그대로 두고, 화면에
보이는 문구만 언어에 맞게 바꿔 끼우는 방식입니다. 페이지를 영어판/한국어판으로 따로 만드는 방식(예:
`/en/sprite/`)도 가능하지만, 그러면 지금처럼 모든 페이지의 문구를 두 벌 관리해야 해서 사람이 유지보수하기
번거롭습니다. 아래 방식이 지금 구조와 더 잘 맞습니다.

1. `assets/js/i18n/ko.json`, `assets/js/i18n/en.json`처럼 언어별 문구 사전을 만듭니다.
   ```json
   { "home.title": "uma-convert", "home.lede": "게임 폴더에서 꺼낸 파일을...", "sprite.saveButton": "PNG 저장" }
   ```
2. 정적 텍스트가 있는 HTML 요소에는 `data-i18n="home.lede"`처럼 사전의 키를 적어 둡니다. (지금 문구는
   그대로 두어도 되고, 사전에 없는 키를 만나면 원래 글자를 그대로 보여주게 만들면 안전합니다.)
3. 작은 공용 스크립트(`assets/js/i18n/index.js`)가 페이지 로딩 시 저장된 언어(주소 뒤의 `?lang=en` 또는
   `localStorage`)를 확인하고, 해당 사전을 불러와 `data-i18n`이 붙은 요소의 글자를 바꿔치기합니다.
4. `tools.js`처럼 JS 코드 안에 있는 문구(타일 설명 등)도 하드코딩된 한국어 대신 사전 키를 참조하도록
   바꾸고, `home.js`/`sprite/main.js`에서 문구를 넣는 자리에 사전 조회 함수를 한 번 거치게 합니다.
5. 화면 오른쪽 위 등에 언어 전환 버튼(또는 드롭다운)을 두고, 누르면 `localStorage`에 저장한 뒤 같은
   페이지를 다시 그리거나(권장) 새로고침합니다.

이렇게 하면 페이지 파일 자체는 지금처럼 한 벌만 유지하면 되고, 새 언어를 추가할 때도 사전 파일 하나만
더 만들면 됩니다. 다만 `<html lang="ko">`나 `<title>`, `<meta name="description">`처럼 HTML 파일 안에
직접 박혀 있는 값은 이 방식만으로는 못 바꾸므로, 언어 전환 스크립트가 `document.title`과
`<html lang>` 속성도 함께 갱신하도록 챙겨야 합니다.

## 저작권

팬이 만든 비공식 도구입니다. 게임 리소스의 저작권은 각 권리자에게 있으니,
변환한 파일을 다시 배포하지 마세요. 이 저장소에 원본 게임 파일을 올리지 않도록 주의하세요.
