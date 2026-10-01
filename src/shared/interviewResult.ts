

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
    employerAccept: boolean | undefined;
    employerTransport: boolean | undefined;
    employerSkills: boolean | undefined;
    employerPositions: string | undefined;
    employerNotes: string | undefined;

    constructor(student: string, wave: string, business: string, position: string, location: string, excitement: string, acceptance: string, rank: string) {
        this.student = student;
        this.wave = Number(wave);
        this.business = business;
        this.position = position;
        this.location = InterviewResult.stringToBool(location);
        this.excitement = InterviewResult.stringToBool(excitement);
        this.acceptance = InterviewResult.stringToBool(acceptance);
        this.rank = Number(rank);
    }

    setEmployerData(employerAccept: string, employerTransport: string, employerSkills: string, employerPositions: string, employerNotes: string) {
        this.employerAccept = InterviewResult.stringToBool(employerAccept);
        this.employerTransport = InterviewResult.stringToBool(employerTransport);
        this.employerSkills = InterviewResult.stringToBool(employerSkills);
        this.employerPositions = employerPositions;
        this.employerNotes = employerNotes;
    }

    private static stringToBool(s: string): boolean | undefined {
        s = s.trim().toLowerCase();

        if (s=="yes") return true;
        if (s=="no") return false;

        return undefined; // fallback
    }
}