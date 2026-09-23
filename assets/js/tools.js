// 메인 페이지에 보이는 변환기 목록입니다.
// 새 변환기를 추가하려면 아래 배열 끝에 항목을 하나 더 적으면 됩니다.
// (README의 "변환기 추가하기"를 참고하세요.)
//
//   title   타일 제목
//   desc    한 줄 설명
//   input   넣는 파일 (생략 가능)
//   output  나오는 결과 (생략 가능)
//   href    페이지 폴더 (메인 페이지 기준 상대 경로)
//   image   타일 그림 (메인 페이지 기준 상대 경로)
//   status  "ready" = 사용 가능, "soon" = 준비 중 (눌러도 이동하지 않음)

export const tools = [
  {
    title: "스프라이트",
    desc: "텍스처 파일을 PNG로 바꾸고, 안에 든 조각을 한 장씩 저장합니다.",
    input: "Root/atlas/ 에서 발견되는 _tex 파일",
    output: "PNG 한 장, 조각별 PNG를 묶은 ZIP",
    href: "sprite/",
    image: "assets/img/tile/tile-sprite.png",
    status: "ready",
  },
  {
    title: "라이브 가사",
    desc: "라이브 곡의 가사 데이터를 읽을 수 있는 텍스트로 바꿉니다.",
    input: "Root/live/musicscores/ 에서 발견되는 _lyrics 파일",
    output: "시간표가 있는 TXT 파일",
    href: "lyrics/",
    image: "assets/img/tile/tile-lyrics.png",
    status: "ready",
  },
  {
    title: ".usm 영상 데이터 변환",
    desc: "암호화 된 인게임 영상 데이터를 변환합니다.",
    href: "usm/",
    image: "assets/img/tile/tile-usm.png",
    status: "soon",
  },
];
