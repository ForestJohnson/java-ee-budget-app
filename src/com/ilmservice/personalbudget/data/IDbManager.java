package com.ilmservice.personalbudget.data;

import java.util.Iterator;
import java.util.Map.Entry;
import java.util.function.Function;

public interface IDbManager {
	
	IDbIndex index(Index index);
	
	public interface IDbIndex {
		byte[] get(byte[] key);
		void put(byte[] key, byte[] value);
		void delete(byte[] key);
		<V> V withIterator(byte[] from, byte[] until, boolean descending, Function<Iterator<byte[]>, V> action);
	}
}
