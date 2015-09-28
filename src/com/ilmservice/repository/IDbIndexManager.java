package com.ilmservice.repository;

import java.util.Iterator;
import java.util.Map.Entry;
import java.util.function.Function;

public interface IDbIndexManager {
	
	IDbIndex index(short indexId);
	
	public interface IDbIndex {
		byte[] get(byte[] key);
		void put(byte[] key, byte[] value);
		void delete(byte[] key);
		<V> V withIterator(byte[] from, byte[] until, boolean descending, Function<Iterator<byte[]>, V> action);
	}
}
