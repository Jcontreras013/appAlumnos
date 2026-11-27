import { describe, expect, it } from "vitest";
import { weekOff } from "./calendar";
import { ageOn } from "./enrollment";
import { attendanceRiskRules } from "./evaluation";
import { withinNotifyHours } from "./messages";
import { describeClassDays, formatWeekRange, isMeetingSchedule, nextClassDay } from "./weeks";

describe("días de clase por jornada", () => {
  it("el rango de la semana va del primer al último día de clase", () => {
    expect(formatWeekRange("2026-11-09")).toBe("9 al 13 de nov de 2026");
    expect(formatWeekRange("2026-11-09", [6, 7])).toBe("14 al 15 de nov de 2026");
    expect(formatWeekRange("2026-11-09", [7])).toBe("15 de nov de 2026");
    expect(formatWeekRange("2026-11-23", [6, 7])).toBe("28 al 29 de nov de 2026");
    expect(formatWeekRange("2026-11-30", [6, 7])).toBe("5 al 6 de dic de 2026");
  });

  it("describe los días en palabras", () => {
    expect(describeClassDays([1, 2, 3, 4, 5])).toBe("lunes a viernes");
    expect(describeClassDays([7, 6])).toBe("sábado y domingo");
    expect(describeClassDays([1, 3, 5])).toBe("lunes, miércoles y viernes");
    expect(describeClassDays([7])).toBe("domingo");
  });

  it("el próximo encuentro y si la jornada es de encuentros", () => {
    expect(nextClassDay("2026-11-09", [6, 7])).toBe("2026-11-14"); // lunes → sábado
    expect(nextClassDay("2026-11-14", [6, 7])).toBe("2026-11-15"); // sábado → domingo
    expect(nextClassDay("2026-11-15", [6, 7])).toBe("2026-11-21"); // domingo → sábado siguiente
    expect(nextClassDay("2026-11-13", [1, 2, 3, 4, 5])).toBe("2026-11-16"); // viernes → lunes
    expect(isMeetingSchedule([6, 7])).toBe(true);
    expect(isMeetingSchedule([1, 2, 3, 4, 5])).toBe(false);
  });

  it("unas vacaciones de lunes a viernes no paran el fin de semana", () => {
    const vacation = [{ startsOn: "2026-11-09", endsOn: "2026-11-13" }];
    expect(weekOff("2026-11-09", vacation)).not.toBeNull();
    expect(weekOff("2026-11-09", vacation, [6, 7])).toBeNull();
    expect(weekOff("2026-11-09", [{ startsOn: "2026-11-14", endsOn: "2026-11-15" }], [6, 7])).not.toBeNull();
  });

  it("en fin de semana la alerta de asistencia salta a la primera falta", () => {
    expect(attendanceRiskRules([6, 7]).maxAbsences).toBe(1);
    expect(attendanceRiskRules([1, 2, 3, 4, 5]).maxAbsences).toBe(5);
  });

  it("avisos sábado y domingo solo en centros con jornada de fin de semana", () => {
    const saturday10 = new Date("2026-11-14T16:00:00Z");
    expect(withinNotifyHours(saturday10)).toBe(false);
    expect(withinNotifyHours(saturday10, { weekends: true })).toBe(true);
    expect(withinNotifyHours(new Date("2026-11-16T03:00:00Z"), { weekends: true })).toBe(false); // domingo 21:00
  });

  it("edad cumplida", () => {
    expect(ageOn("2008-11-10", "2026-11-09")).toBe(17);
    expect(ageOn("2008-11-09", "2026-11-09")).toBe(18);
  });
});
