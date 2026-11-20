import { styles, type ShowcaseSource } from "../kit.ts";

/* People going into space, on one line of years: the milestones alternate above and below
 * so none collide, the Moon landing set apart. */

export const space: ShowcaseSource = {
  id: "space",
  title: (say) => say("人类走向太空", "Into space"),
  brief: (say) => ({
    subject: say("航天史上的里程碑", "Milestones of spaceflight"),
    intent: say("从第一颗卫星到登陆火星，人类走了多远、多快", "How far and how fast we went, from the first satellite to Mars"),
    audience: say("对航天好奇的中学生", "Students curious about spaceflight"),
    concept: say(
      "一条从 1957 到 2021 的时间轴，事件上下交替排开；登月一格用强调色，左边一位宇航员看着这条路",
      "One axis from 1957 to 2021 with the events alternating above and below; the Moon landing in the accent colour, an astronaut at the start looking along it",
    ),
    register: "formal",
    style: "duotone-icon",
    direction: say("干净的时间轴，赤陶色只给登月", "A clean axis, terracotta only for the Moon landing"),
    cast: [say("宇航员", "an astronaut")],
    basis: { subject: say("航天", "spaceflight"), intent: say("大事记", "the milestones") },
  }),
  versions: (say) => [
    {
      title: say("人类走向太空", "Into space"),
      style: { ...styles["duotone-icon"] },
      scenes: [{ id: "root", title: say("航天大事记", "Milestones"), checks: [] }],
      modules: [
        { id: "astronaut", bounds: [0, 110, 170, 210], drawingId: "picture", data: { material: "astronaut" } },
        {
          id: "line",
          bounds: [190, 60, 1040, 300],
          drawingId: "timeline",
          data: {
            size: 18,
            from: 1952,
            to: 2026,
            events: [
              { at: 1957, label: say("第一颗人造卫星", "First satellite"), note: say("斯普特尼克 1 号", "Sputnik 1") },
              { at: 1961, label: say("加加林进入太空", "Gagarin in orbit") },
              { at: 1969, label: say("阿波罗 11 号登月", "Apollo 11 on the Moon"), accent: true },
              { at: 1990, label: say("哈勃望远镜升空", "Hubble launched") },
              { at: 2003, label: say("杨利伟乘神舟五号", "Yang Liwei, Shenzhou 5") },
              { at: 2019, label: say("嫦娥四号着陆月背", "Chang'e 4 on the far side") },
              { at: 2021, label: say("祝融号登陆火星", "Zhurong on Mars") },
            ],
          },
        },
      ],
    },
  ],
};
