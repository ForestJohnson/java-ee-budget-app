package com.ilmservice.personalbudget.data;

import javax.annotation.PreDestroy;
import javax.ejb.Singleton;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import org.iq80.leveldb.*;
import static org.iq80.leveldb.impl.Iq80DBFactory.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.Map.Entry;
import java.util.function.Function;

@Singleton
@Stateless
@Default
public class LevelDbManager implements IDbManager {

	private final String fileName = "testLevelDb5";
	private final Map<Index, LevelDbIndex> indexes;
	private final DB db;
	
	private LevelDbManager () throws IOException {
		Options options = new Options();
		options.createIfMissing(true);
		options.compressionType(CompressionType.NONE);
		db = factory.open(new File(fileName), options);
		System.out.println("DB opened");
		
		this.indexes = new HashMap<Index, LevelDbIndex>();
	}
	
	public IDbIndex index(Index index) {
		return indexes.computeIfAbsent(index, (i) -> {
			return new LevelDbIndex(i, db);
		});
	}
	
	@PreDestroy
	public void close() {
		System.out.println("DB closing");
		try {
			db.close();
		} catch (IOException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		System.out.println("DB closed");
	}
	
	public class LevelDbIndex implements IDbIndex {
		
		private final Index index;
		private final DB levelDb;
		private final short indexShort;
		
		public LevelDbIndex(Index index, DB levelDb) {
			this.index = index;
			this.levelDb = levelDb;
			
			indexShort = (short)(index.getValue());
		}
		
		@Override
		public byte[] get(byte[] key) {
			return levelDb.get(getKey(indexShort, key));
		}

		@Override
		public void put(byte[] key, byte[] value) {
			levelDb.put(getKey(indexShort, key), value);
		}
		
		@Override
		public void delete(byte[] key) {
			levelDb.delete(getKey(indexShort, key));
		}

		@Override
		public <V> V withIterator(
				byte[] from, 
				byte[] until, 
				boolean descending, 
				Function<Iterator<byte[]>, V> action) {
			V result = null;
			try(DBIterator iterator = levelDb.iterator()) {
				
//				if(descending && from == null) {
//					byte[] firstOfNextIndex = getKey((short)(index.getValue()+1), new byte[1]);
//					iterator.seek(firstOfNextIndex);
//					if(iterator.hasPrev()) {
//						if(ByteArrayComparator.compare(iterator.peekPrev().getKey(), firstOfNextIndex) == 0) {
//							from = iterator.prev().getKey();	
//						}
//					}
//				}
				
				byte[] firstOfIndex = getKey((short)(index.getValue()), new byte[1]);
				byte[] firstOfNextIndex = getKey((short)(index.getValue()+1), new byte[1]);
				
				from = from != null ? 
						getKey((short)(index.getValue()), from) 
					 : (descending ? firstOfNextIndex : firstOfIndex);
						
				until = until != null ? 
						getKey((short)(index.getValue()), until) 
					 : (descending ? firstOfIndex : firstOfNextIndex);
				
				result = action.apply(new LevelDbIterator(
						iterator,
						from,
						until,
						descending
						));
			} catch (IOException e) {
				e.printStackTrace();
			}
			return result;
		}
		
		private byte[] getKey (short index, byte[] keyValue) {
			return ByteBuffer.allocate(2+keyValue.length).putShort(index).put(keyValue).array();
		}
		
		private class LevelDbIterator implements Iterator<byte[]> {

			private final DBIterator underlying;
			//private final byte[] from;
			private final byte[] until;
			private final boolean descending;
			private Entry<byte[], byte[]> next;
			
			public LevelDbIterator (
					DBIterator underlying, 
					byte[] from, 
					byte[] until, 
					boolean descending) {
				this.underlying = underlying;
				//this.from = from;
				this.until = until;
				this.descending = descending;
				underlying.seek(from);
			}

			@Override
			public boolean hasNext() {
				if(descending ? underlying.hasPrev() : underlying.hasNext() ) {
					next = descending ? underlying.prev() : underlying.next();
					int nextKeyCompared = ByteArrayComparator.compare(next.getKey(), until);
					if( (descending && nextKeyCompared >= 0) || (!descending && nextKeyCompared < 0)) {
						return true;
					}
				}
				next = null;
				return false;
			}
			
			@Override
			public byte[] next() {
				return next.getValue();
			}
			
		}
	}

}


