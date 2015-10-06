package com.ilmservice.repository;

import java.io.IOException;
import java.util.Iterator;
import java.util.Map.Entry;
import java.util.function.Consumer;
import java.util.function.Function;

public interface IDbManager  {
	
	IDbIndex index(short indexId);
	IDbTransaction openTransaction();
	
	public interface IDbIndex {
		byte[] get(byte[] key);
		void put(byte[] key, byte[] value);
		void delete(byte[] key);
		void withIterator(byte[] from, byte[] until, boolean descending, Consumer<Iterator<byte[]>> action);
	}
	
	public interface IDbTransaction {
		IDbIndex index(short indexId);
		void execute()  throws Exception;
		void close() throws IOException;
	}
}
