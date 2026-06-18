import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper to check if a date range includes weekends
function calculateBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Sunday, 6 = Saturday
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, startDate, endDate, leaveType } = body;

    // 1. Basic Validation
    if (!userId || !startDate || !endDate || !leaveType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return NextResponse.json({ error: 'Start date cannot be after end date' }, { status: 400 });
    }

    // 2. Validate against overlapping approved leaves for this user
    const overlappingLeave = await prisma.leaveRequest.findFirst({
      where: {
        userId: userId,
        status: 'approved',
        AND: [
          { startDate: { lte: end } },
          { endDate: { gte: start } }
        ]
      }
    });

    if (overlappingLeave) {
      return NextResponse.json(
        { error: 'This user already has an approved holiday during this period.' },
        { status: 400 }
      );
    }

    // 3. Optional: Business day check
    const businessDays = calculateBusinessDays(start, end);
    if (businessDays === 0) {
      return NextResponse.json({ error: 'Leave request cannot contain only weekends.' }, { status: 400 });
    }

    // 4. Save to Database
    const newLeave = await prisma.leaveRequest.create({
      data: {
        userId,
        startDate: start,
        endDate: end,
        leaveType,
        status: 'approved' // Auto-approving for this base utility code
      },
      include: { user: true }
    });

    return NextResponse.json(newLeave, { status: 201 });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Fetch all leaves accompanied by the user details to populate the UI view
    const leaves = await prisma.leaveRequest.findMany({
      include: {
        user: {
          select: { name: true, team: true }
        }
      },
      orderBy: { startDate: 'asc' }
    });
    return NextResponse.json(leaves, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}