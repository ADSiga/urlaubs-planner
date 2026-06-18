'use client';

import React, { useState, useEffect } from 'react';

interface LeaveEvent {
  id: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  user: { name: string; team: string };
}

export default function TeamCalendar() {
  const [leaves, setLeaves] = useState<LeaveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [leaveType, setLeaveType] = useState('vacation');
  const [message, setMessage] = useState({ text: '', isError: false });

  useEffect(() => {
    fetchLeaves();
  }, []);

  const fetchLeaves = async () => {
    try {
      const res = await fetch('/api/leaves');
      const data = await res.json();
      if (res.ok) setLeaves(data);
    } catch (err) {
      console.error("Failed fetching records", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: '', isError: false });

    const res = await fetch('/api/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, startDate, endDate, leaveType })
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage({ text: data.error || 'An error occurred', isError: true });
    } else {
      setMessage({ text: 'Holiday booked successfully!', isError: false });
      fetchLeaves(); // Refresh calendar view
      setStartDate('');
      setEndDate('');
    }
  };

  // Quick helper for team color badges
  const getTeamColor = (team: string) => {
    switch (team.toLowerCase()) {
      case 'engineering': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'marketing': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto font-sans">
      <h1 className="text-3xl font-bold mb-8 text-gray-900">Team Holiday Planner</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Input Form Column */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-fit">
          <h2 className="text-xl font-semibold mb-4">Book Time Off</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User ID Simulation</label>
              <input 
                type="text" 
                placeholder="Paste User UUID"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input 
                  type="date" 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input 
                  type="date" 
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select 
                className="w-full p-2 border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
              >
                <option value="vacation">Vacation</option>
                <option value="sick">Sick Leave</option>
                <option value="public_holiday">Public Holiday</option>
              </select>
            </div>

            <button 
              type="submit" 
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition duration-150"
            >
              Add Leave Entry
            </button>
          </form>

          {message.text && (
            <div className={`mt-4 p-3 rounded-md text-sm font-medium border ${
              message.isError ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        {/* Dynamic Display Log Grid Column */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Upcoming Team Off-Days</h2>
          
          {loading ? (
            <p className="text-gray-500 animate-pulse">Loading operational timeline records...</p>
          ) : leaves.length === 0 ? (
            <p className="text-gray-400 text-sm">No holidays registered in system storage yet.</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {leaves.map((leave) => (
                <div 
                  key={leave.id} 
                  className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{leave.user.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${getTeamColor(leave.user.team)}`}>
                        {leave.user.team}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(leave.startDate).toLocaleDateString()} to {new Date(leave.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="capitalize text-xs font-semibold px-2.5 py-1 rounded bg-gray-100 text-gray-700">
                    {leave.leaveType.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}