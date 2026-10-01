

export class InterviewResult {

    // values from student fit
    student: string;
    wave: number;
    business: string;
    position: string;
    location: boolean | undefined;
    excitement: boolean | undefined;
    acceptance: boolean | undefined;
    rank: number;

    // values from employer fit
    employerAccept: boolean | undefined = undefined;
    employerTransport: boolean | undefined = undefined;
    employerSkills: boolean | undefined = undefined;
    employerPositions: string | undefined = undefined;
    employerNotes: string | undefined = undefined;

    constructor(student: string, wave: string, business: string, position: string, location: string, excitement: string, acceptance: string, rank: string) {
        this.student = student;
        this.wave = Number(wave);
        this.business = business;
        this.position = position;
        this.location = this.#stringToBool(location);
        this.excitement = this.#stringToBool(excitement);
        this.acceptance = this.#stringToBool(acceptance);
        this.rank = Number(rank);
    }

    setEmployerData(employerAccept: string, employerTransport: string, employerSkills: string, employerPositions: string, employerNotes: string) {
        this.employerAccept = this.#stringToBool(employerAccept);
        this.employerTransport = this.#stringToBool(employerTransport);
        this.employerSkills = this.#stringToBool(employerSkills);
        this.employerPositions = employerPositions;
        this.employerNotes = employerNotes;
    }

    #stringToBool(s: string): boolean | undefined {
        s = s.trim().toLocaleLowerCase();

        if (s=="yes") return true;
        if (s=="no") return false;

        return undefined; // fallback
    }
}