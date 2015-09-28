package com.ilmservice.repository;

public class ByteArrayComparator {
	
	public static int compare(byte[] o1, byte[] o2) {
		
		int minLen = Math.min(o1.length, o2.length);
		
		for (int i = 0; i < minLen; i++) {
			int a = (o1[i] & 0xff);
			int b = (o2[i] & 0xff);
			
			if (a != b) {
				return a - b;
			}
		}
		
		return o1.length - o2.length;
	}
}	